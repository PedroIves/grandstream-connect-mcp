# MCP Grandstream GWN7672

Servidor MCP de consulta para o Grandstream GWN7672. Usa o SDK oficial do MCP sobre **stdio** e SSH com PTY. A implementação foi validada nos menus do firmware `1.0.25.7` e verifica a fingerprint SHA-256 configurada para o equipamento.

## Instalação e teste

Node.js 22 ou superior. Execute na pasta do pacote:

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run profiles
npm.cmd test
```

Copie `device.example.json` para `device.local.json` e informe o endereço, porta, usuário e a fingerprint SSH conferida por uma fonte confiável. O arquivo local é ignorado pelo Git. O servidor encerra a conexão diante de uma chave diferente.

Os perfis usam caminhos absolutos. Gere-os de novo se mover a pasta ou trocar de computador. O servidor escreve apenas MCP em stdout.

### Autenticação

Para uso contínuo, configure `GWN_SSH_KEY` com o caminho de uma chave já autorizada no AP. Se for protegida por frase secreta, o processo também aceita `GWN_SSH_KEY_PASSPHRASE`. O servidor lê a chave diretamente. O suporte anunciado a chaves pelo SSH do AP não garante que a chave do Windows esteja autorizada. A autorização de uma nova chave depende de um procedimento compatível com o firmware e de aprovação para alterar o AP.

Para teste temporário no Windows, use o prompt oculto abaixo. Inicie o agente a partir desse mesmo ambiente, se ele repassar a variável ao processo MCP. Aplicativos já abertos podem exigir encerramento completo e nova abertura nesse ambiente. No Codex, o perfil inclui a lista explícita de variáveis repassadas.

```powershell
$gwnCredential = Read-Host 'Senha SSH temporária do Grandstream' -AsSecureString
$gwnPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($gwnCredential)
try {
    $env:GWN_SSH_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($gwnPointer)
    npm.cmd run test:live
} finally {
    Remove-Item Env:GWN_SSH_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($gwnPointer)
    $gwnCredential.Dispose()
}
```

O servidor aceita a senha temporária no ambiente do processo. Deixe o campo de senha fora dos arquivos JSON, TOML e do histórico de comandos. Para clientes que filtram o ambiente, configure o caminho não secreto de uma chave já autorizada na entrada do MCP.

## Integração com os agentes

Para experimentar sem mudar sua configuração global, abra esta pasta como projeto no agente. Gere as configurações locais com `npm.cmd run profiles -- --workspace`. Para OpenCode V1, acrescente `--opencode-v1` na primeira geração. Se o agente pedir confiança para o projeto, revise a entrada e habilite-a.

Mescle somente a entrada `grandstream_gwn7672` no arquivo ativo do agente. Preserve os servidores já cadastrados. Reabra a sessão do agente após salvar.

| Cliente | Perfil e local |
|---|---|
| Codex | `profiles/codex.toml`. Adicione a seção ao `config.toml` da instância do Codex ou use a seção MCP nas configurações do app. |
| ZCode | `profiles/zcode.json` para `mcp.servers` em `~/.zcode/cli/config.json` ou no `.zcode/config.json` do projeto. Pela interface, use **Settings → MCP Servers → New → JSON** com o perfil `antigravity.json`, que usa o formato de importação `mcpServers`. |
| OpenCode | `profiles/opencode-v2.json` para `mcp.servers`. Em releases V1, use `profiles/opencode-v1.json`. Mescle no `opencode.json(c)` ativo e confirme com `opencode mcp list`. |
| Antigravity | `profiles/antigravity.json`. No IDE, abra **MCP Servers → Manage MCP Servers → View raw config** para identificar o arquivo ativo da instalação. O CLI também aceita `.agents/mcp_config.json` no projeto. |
| T3 Code | Com o provedor **Codex**, use o mesmo perfil Codex no diretório de configuração ativo. No provedor **Antigravity ACP**, há instalações em que o runtime lê `profiles/antigravity.json` no `config/mcp_config.json` do perfil do provedor em T3. A localização depende da versão e do perfil. Valide em uma sessão nova do T3. |

Para o primeiro teste em cada agente, peça “Use grandstream_gwn7672 para consultar o modelo, firmware e portas Ethernet”. A descoberta das ferramentas independe do login no AP. A chamada de consulta precisa da credencial.

## Operação

As ferramentas são `get_status`, `list_access_points`, `list_ssids`, `list_clients`, `get_radios`, `get_dhcp` e `get_mesh`. Cada resposta informa o horário em UTC, a tela normalizada e um resumo estruturado quando há campos reconhecidos. Os nomes de redes e clientes na tela são dados vindos do AP.

O servidor fixa o destino e a chave SSH, usa rotas de menu predefinidas, valida a tela antes de enviar a próxima seleção e limita tempo e paginação. A sessão SSH termina após cada consulta. A medição de ocupação de banda pode afetar o Wi-Fi e está fora do MCP. Uma alteração de firmware ou de chave exige revisar a compatibilidade ou conferir a identidade atual por uma fonte independente, conforme o caso.

### Acesso fora da rede local

Se o agente roda na rede local e só o modelo está na nuvem, o servidor MCP continua local. Se o agente roda em outro computador, execute este mesmo pacote lá e forneça uma rota privada até o AP, por exemplo uma VPN com roteamento da sub-rede. A rede remota precisa alcançar a porta SSH configurada via esse túnel. O pacote usa stdio. Valide a conexão a partir da máquina remota antes de ativar o MCP nela.

### Referências

- [Grandstream GWN76xx Command Line Guide](https://documentation.grandstream.com/knowledge-base/gwn76xx-command-line-guide/)
- [Grandstream GWN API Guide](https://documentation2.grandstream.com/knowledge-base/gwn-api-guide/)
- [ZCode MCP](https://zcode.z.ai/en/docs/mcp-services)
- [OpenCode MCP](https://opencode.ai/docs/mcp-servers/)
- [Antigravity MCP](https://antigravity.google/docs/mcp?tab=ide)
- [T3 Code e o provedor Codex](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md)
- [Discussão do T3 Code sobre MCP no provedor Antigravity ACP](https://github.com/pingdotgg/t3code/discussions/13117)
