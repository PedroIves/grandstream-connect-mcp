import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { screenText } from './ap.mjs';

assert.equal(screenText('\x1b[2JMenu\r\n\x1b[3;1H[1] Status'), 'Menu\n[1] Status');
const live = process.argv.includes('--live');
const client = new Client({ name: 'grandstream-check', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    live || !name.startsWith('GWN_SSH_'))),
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
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
