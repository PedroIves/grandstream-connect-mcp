# Grandstream Connect MCP

Read live status, Wi-Fi clients, SSIDs, and radio settings from a Grandstream GWN7672 using Claude Code, Codex, or another MCP client. The server connects directly to the access point over SSH. It starts in read-only mode and can optionally expose an operator-approved session for the interactive Grandstream CLI.

**Requirements** · Node.js 22+ · SSH access to your GWN7672 · A verified SSH host fingerprint · An authorized SSH credential

Tested against the GWN7672 interactive CLI on firmware `1.0.25.7`. Other firmware versions may expose different menus.

## Install

Clone the repository on the computer that runs your MCP client and can reach the AP:

```sh
git clone https://github.com/PedroIves/grandstream-connect-mcp.git
cd grandstream-connect-mcp
npm ci --ignore-scripts
npm test
```

Copy `device.example.json` to `device.local.json` from your editor, or run `cp device.example.json device.local.json` in a POSIX shell. In Windows PowerShell, use `Copy-Item device.example.json device.local.json`. Edit the file with your AP host, SSH port, SSH username, and verified `SHA256:…` host fingerprint. The fingerprint must come from a trusted source, such as a previously verified OpenSSH `known_hosts` entry. The server rejects mismatches. Git ignores the local device file.

### Authenticate and verify the connection

Set `GWN_SSH_KEY` to the absolute path of a private key already authorized on the AP. An encrypted key also requires `GWN_SSH_KEY_PASSPHRASE` in the MCP process environment. For password authentication, supply `GWN_SSH_PASSWORD` through the launching process environment. Keep credentials out of the repository and client configuration files.

On Windows, a one-session password test can use a hidden prompt:

```powershell
$credential = Read-Host 'Grandstream SSH password' -AsSecureString
try {
    $env:GWN_SSH_PASSWORD = [System.Net.NetworkCredential]::new('', $credential).Password
    npm.cmd run test:live
} finally {
    Remove-Item Env:GWN_SSH_PASSWORD -ErrorAction SilentlyContinue
    $credential.Dispose()
}
```

The live test starts the MCP server and calls all seven tools against your AP. `npm test` checks the MCP transport and tool catalog without connecting to the device. To use a temporary password from your agent, launch the agent from an environment that passes the variable to its MCP child process.

## Claude Code

From the cloned directory, run either of the following blocks. Both register the server for your local Claude Code user. The absolute paths allow it to start from other projects.

**Windows PowerShell**

```powershell
$nodePath = (Get-Command node.exe).Source
$serverPath = (Resolve-Path ./server.mjs).Path
claude mcp add --transport stdio --scope user grandstream_gwn7672 -- $nodePath $serverPath
claude mcp list
```

**macOS or Linux**

```sh
claude mcp add --transport stdio --scope user grandstream_gwn7672 -- "$(command -v node)" "$PWD/server.mjs"
claude mcp list
```

For project scope, run `npm run profiles -- --workspace` and open the cloned folder in Claude Code. The generator creates `.mcp.json` if it does not exist. For another project, merge the entry from `profiles/claude-code.json` into its `.mcp.json`. Approve the project server when Claude Code prompts you.

In a new session, use `/mcp` to check the connection and try:

> Use Grandstream Connect MCP to show the access point firmware, uptime, and Ethernet link status.

A connected MCP status confirms the server started. A successful tool call also requires SSH reachability and valid credentials. [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

## Other MCP clients

Run `npm run profiles` to generate the following client configurations. Merge only the `grandstream_gwn7672` entry into your active client configuration. If you move the clone, regenerate the profiles and update the command path.

| Client | Profile and configuration |
| --- | --- |
| Codex | `profiles/codex.toml` → the active Codex `config.toml`. |
| ZCode | `profiles/zcode.json` → `mcp.servers` in `~/.zcode/cli/config.json` or `.zcode/config.json`. |
| OpenCode | `profiles/opencode-v2.json` → `mcp.servers`. For V1 use `profiles/opencode-v1.json` → `mcp`. |
| Antigravity | `profiles/antigravity.json` → the file shown by **Manage MCP Servers → View raw config**. |
| T3 Code | Use the Codex profile with its Codex provider. Some Antigravity ACP installations read the Antigravity profile from the provider's `config/mcp_config.json`. Confirm the configuration in a new T3 session. |

If a client filters environment variables, explicitly allow the required variables or configure the non-secret `GWN_SSH_KEY` path in its MCP environment settings. The MCP server can run on another machine with a private route to the AP, such as a VPN. It uses local stdio and requires no public SSH or MCP endpoint.

## Available tools

| Tool | Returns |
| --- | --- |
| `get_status` | Model, firmware, uptime, role, and Ethernet link state |
| `list_access_points` | Paired AP inventory and online/offline counts |
| `list_ssids` | Configured SSIDs, status, VLAN, and visibility |
| `list_clients` | Associated clients, channels, RSSI, and link rates reported by the AP |
| `get_radios` | Radio settings, including configured width and transmit power |
| `get_dhcp` | DHCP status and configured VLANs |
| `get_mesh` | Mesh configuration |

Responses include the collection time in UTC, normalized CLI text, and a structured summary when fields are recognized. The AP's own CLI text is returned in its original language. Automatic queries use predefined menu paths and exclude maintenance actions and band utilization measurements.

## Interactive administration

Set `GWN_ENABLE_ADMIN=1` in the MCP server's environment and reconnect the client. Administration requires a client that can show **MCP form elicitation** to the operator. A client without that capability can still use all seven read-only tools. When using the generated Codex profile, start Codex from an environment where the opt-in and SSH credential variables are available. Allow at least 120 seconds per administrative tool call in clients that expose a timeout setting.

| Tool | Purpose |
| --- | --- |
| `admin_open_session` | Open a pinned SSH session and verify the GWN7672 main menu. |
| `admin_read_screen` | Read the latest CLI output and screen revision. |
| `admin_send_input` | Propose one printable line followed by Enter. The client must present the exact line for operator approval. |
| `admin_close_session` | Close the session. |

Use the actual menu on the device to navigate SSIDs, AP membership, clients and banned clients, DHCP/VLAN, mesh, email, maintenance, radios, access lists, rogue APs, and diagnostics. For example, to configure an SSID, open the session, inspect the menu, then propose the SSIDs selection shown on that screen. Read the resulting screen before proposing each subsequent selection, field value, or save. The current firmware and AP role determine the available actions. The [Grandstream CLI guide](https://documentation.grandstream.com/knowledge-base/gwn76xx-command-line-guide/) documents menu behavior, and the [GWN76xx manual](https://documentation.grandstream.com/knowledge-base/gwn76xx-user-manual/) explains configuration fields.

An approval covers exactly one input for the current screen revision. If the screen changes during the approval, read it again. Sessions expire after two minutes of inactivity or twenty minutes in total. If the AP disconnects, reboots, or does not return a stable screen, verify the outcome before trying the action again.

Use the Grandstream UI or a private SSH terminal for password entry and credential changes. MCP inputs and CLI output can appear in the client transcript. The server masks common labeled secrets as a convenience. Use interactive administration only in trusted clients that actually show elicitation to a human operator.

The administrative workflow is tested with simulated CLI responses. Menu sequences that change AP settings have not been verified on live hardware. This mode provides access to the firmware's interactive SSH menu, whose coverage can differ from the embedded web UI or controller API.

## Troubleshooting

- **Client cannot start the server:** run `npm test` from the clone, check Node.js 22 or later, and check the absolute Node and server paths in the client.
- **Server is connected but the tool call fails:** check `device.local.json`, the SSH port, and whether the MCP process receives the credential. Run `npm run test:live` to isolate the SSH path.
- **SSH host key mismatch:** verify the new fingerprint independently before changing the local device file.
- **Unexpected CLI screen:** confirm the AP model, firmware, and role. See the [Grandstream GWN76xx CLI guide](https://documentation.grandstream.com/knowledge-base/gwn76xx-command-line-guide/).
