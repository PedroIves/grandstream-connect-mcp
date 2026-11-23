import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { screenText } from './ap.mjs';
import { createAdmin } from './admin.mjs';

assert.equal(screenText('\x1b[2JMenu\r\n\x1b[3;1H[1] Status'), 'Menu\n[1] Status');
const live = process.argv.includes('--live');
const adminCatalog = process.argv.includes('--admin-catalog');
const client = new Client({ name: 'grandstream-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      name !== 'GWN_ENABLE_ADMIN' && (live || !name.startsWith('GWN_SSH_')))),
    GWN_ENABLE_ADMIN: adminCatalog ? '1' : '0',
  },
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, adminCatalog ? 11 : 7);
  assert.ok(tools.filter(tool => !tool.name.startsWith('admin_')).every(tool => tool.annotations.readOnlyHint));
  if (adminCatalog) {
    const inaccessible = await client.callTool({ name: 'admin_open_session' });
    assert.equal(inaccessible.isError, true);
    assert.match(inaccessible.content[0].text, /form elicitation/);
  }
  const rejected = await client.callTool({
    name: 'get_status', arguments: { key: '99' },
  });
  assert.equal(rejected.isError, true);
  if (live) {
    for (const { name } of tools) {
      const result = await client.callTool({ name }, undefined, { timeout: 30000 });
      assert.ok(!result.isError, result.content[0]?.text);
      assert.ok(result.structuredContent?.screen);
      if (name === 'get_status') {
        assert.equal(result.structuredContent.summary.model, 'GWN7672');
        assert.match(result.structuredContent.summary.firmware, /^\d+(\.\d+){3}$/);
        assert.equal(result.structuredContent.summary.ethernet.length, 2);
      }
      console.log(name + ' OK');
    }
  } else {
    const result = await client.callTool({ name: 'get_status' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /GWN_SSH_KEY/);
  }
  console.log('MCP stdio OK');
} finally {
  await client.close();
}

if (!live) {
  const channel = new EventEmitter();
  const writes = [];
  let permitted = false;
  let changeDuringApproval = false;
  channel.write = line => {
    writes.push(line);
    channel.emit('data', Buffer.from('SSIDs\nPassword: sample\n'));
  };
  const admin = createAdmin(async () => {
    if (changeDuringApproval) channel.emit('data', Buffer.from('Refreshed menu\n'));
    return permitted;
  }, async () => {
    setImmediate(() => channel.emit('data', Buffer.from(
      'GWN7672(Primary) - test\nMain Menu\nSelect by pressing the [number] or [letter] and then ENTER\n',
    )));
    return { channel, target: 'test.invalid:22', close: () => { channel.destroyed = true; } };
  });
  const { sessionId, revision } = await admin.open();
  const request = { sessionId, revision, line: '3', purpose: 'Open the SSID menu' };
  try {
    await assert.rejects(admin.input(request), /did not approve/);
    await assert.rejects(admin.input({ ...request, line: '3\r9' }), /one printable/);
    assert.deepEqual(writes, []);
    permitted = true;
    changeDuringApproval = true;
    await assert.rejects(admin.input(request), /changed during approval/);
    assert.deepEqual(writes, []);
    changeDuringApproval = false;
    const refreshed = await admin.screen(sessionId);
    const next = await admin.input({ ...request, revision: refreshed.revision });
    assert.deepEqual(writes, ['3\r']);
    assert.match(next.screen, /Password: \[redacted\]/);
    await assert.rejects(admin.input(request), /screen changed/);
    assert.deepEqual(writes, ['3\r']);
  } finally {
    await admin.close(sessionId);
  }
  assert.equal(channel.destroyed, true);
  console.log('Admin approval, input validation, and screen revision OK');
}
