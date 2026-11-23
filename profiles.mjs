import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const server = 'grandstream_gwn7672';
const entry = fileURLToPath(new URL('./server.mjs', import.meta.url));
const command = process.execPath;
const stdio = { command, args: [entry] };
const openCode = { type: 'local', command: [command, entry], enabled: true, timeout: 30000 };
const folder = new URL('./profiles/', import.meta.url);
const profiles = {
  'codex.toml': [
    '[mcp_servers.' + server + ']',
    'command = ' + JSON.stringify(command),
    'args = ' + JSON.stringify([entry]),
    'env_vars = ["GWN_SSH_KEY", "GWN_SSH_KEY_PASSPHRASE", "GWN_SSH_PASSWORD", "GWN_ENABLE_ADMIN"]',
    'tool_timeout_sec = 120',
  ].join('\n') + '\n',
  'zcode.json': { mcp: { servers: { [server]: stdio } } },
  'opencode-v1.json': { mcp: { [server]: openCode } },
  'opencode-v2.json': { mcp: { servers: { [server]: openCode } } },
  'antigravity.json': { mcpServers: { [server]: stdio } },
  'claude-code.json': { mcpServers: { [server]: { type: 'stdio', ...stdio } } },
};
await mkdir(folder, { recursive: true });
const serialize = profile => typeof profile === 'string' ? profile : JSON.stringify(profile, null, 2) + '\n';
for (const [name, profile] of Object.entries(profiles)) {
  await writeFile(new URL(name, folder), serialize(profile));
}
console.log('Profiles written to ' + fileURLToPath(folder));

if (process.argv.includes('--workspace')) {
  const openCodeVersion = process.argv.includes('--opencode-v1') ? 'v1' : 'v2';
  const workspace = {
    '.codex/config.toml': 'codex.toml',
    '.zcode/config.json': 'zcode.json',
    '.agents/mcp_config.json': 'antigravity.json',
    '.mcp.json': 'claude-code.json',
    'opencode.json': 'opencode-' + openCodeVersion + '.json',
  };
  for (const [destination, name] of Object.entries(workspace)) {
    const target = new URL('./' + destination, import.meta.url);
    const content = serialize(profiles[name]);
    await mkdir(new URL('.', target), { recursive: true });
    try {
      await writeFile(target, content, { flag: 'wx' });
      console.log('Created: ' + destination);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await readFile(target, 'utf8') !== content) {
        console.error('Existing file preserved. Merge profiles/' + name + ' into ' + destination);
      }
    }
  }
}
