# Dev Browser

Automação de browser para Claude Code via MCP. Controle o Opera GX (ou Chrome/Edge) diretamente pelo Claude, sem precisar iniciar nada manualmente.

Baseado no [dev-browser](https://github.com/sawyerhood/dev-browser) de [Sawyer Hood](https://github.com/sawyerhood), com extensão de funcionalidades: MCP server dedicado, side panel, gerenciamento de tabs, e relay URL configurável.

## O que faz

- **Extensão de browser** — Conecta seu navegador ao relay server via Chrome DevTools Protocol (CDP)
- **MCP Server** — Expõe 10 tools de automação pro Claude Code usar diretamente
- **Relay auto-start** — O relay inicia automaticamente na primeira tool call, sem setup manual

## Instalação

### 1. Instalar dependências do server

```bash
cd skills/dev-browser
npm install
```

### 2. Instalar a extensão no browser

1. Abra `opera://extensions` (ou `chrome://extensions`)
2. Ative o **Modo desenvolvedor** (toggle no canto superior direito)
3. Clique em **Carregar sem compactação** / **Load unpacked**
4. Selecione a pasta `extension/dist` deste repo
5. A extensão "dev-browser" vai aparecer na barra

### 3. Configurar o MCP Server no Claude Code

Adicione no seu `~/.claude/settings.json`, dentro de `"mcpServers"`:

```json
"dev-browser": {
  "command": "npx",
  "args": ["tsx", "/CAMINHO/COMPLETO/dev-browser/skills/dev-browser/scripts/start-mcp.ts"],
  "cwd": "/CAMINHO/COMPLETO/dev-browser/skills/dev-browser"
}
```

Substitua `/CAMINHO/COMPLETO/` pelo path real onde clonou o repo.

### 4. Reiniciar o Claude Code

Feche e abra o Claude Code para ele reconhecer o novo MCP server.

## Como usar no dia a dia

### Fluxo básico

1. **Abra o browser** normalmente (Opera GX, Chrome, Edge)
2. **Clique na extensão** dev-browser na barra — ela vai conectar ao relay
3. **Use o Claude** normalmente — ele agora tem acesso às tools de browser

O Claude pode fazer coisas como:

```
"Abre o google e pesquisa por X"
"Faz um screenshot da página atual"
"Clica no botão de login"
"Lê o conteúdo da página"
"Preenche o formulário com meus dados"
```

### Tools disponíveis

| Tool | O que faz |
|------|-----------|
| `browser_list_tabs` | Lista todas as tabs abertas no browser |
| `browser_attach_tab` | Conecta a uma tab específica para automação |
| `browser_snapshot` | Lista targets controlados (tabs já conectadas) |
| `browser_navigate` | Navega para uma URL |
| `browser_read_page` | Lê o texto da página (ou de um elemento específico) |
| `browser_screenshot` | Tira screenshot e salva como PNG |
| `browser_click` | Clica em um elemento (por CSS selector ou texto) |
| `browser_type` | Digita texto em um input |
| `browser_evaluate` | Executa JavaScript na página |
| `browser_get_snapshot` | Retorna a árvore ARIA de acessibilidade da página |

### Exemplos práticos

**Pesquisar algo:**
> "Lista as tabs, attach na do Google, pesquisa 'playwright mcp' e me mostra os resultados"

**Preencher formulário:**
> "Attach na tab do formulário, preenche o campo email com 'meu@email.com' e clica em Enviar"

**Inspecionar página:**
> "Faz um screenshot da página atual" ou "Lê o conteúdo do body"

**Debug/Dev:**
> "Executa `document.querySelectorAll('a').length` na página" (via browser_evaluate)

## Arquitetura

```
Browser (Opera/Chrome/Edge)
    │
    │ Chrome DevTools Protocol
    │
    ▼
Extensão (extension/dist)
    │
    │ WebSocket
    │
    ▼
Relay Server (auto-start na porta 9222)
    │
    │ HTTP + CDP
    │
    ▼
MCP Server (stdio)
    │
    │ MCP Protocol
    │
    ▼
Claude Code
```

- **Extensão** — Roda no browser, intercepta o CDP e encaminha via WebSocket pro relay
- **Relay** — Ponte WebSocket entre a extensão e clientes Playwright
- **MCP Server** — Traduz tool calls do Claude em comandos Playwright
- **Lazy init** — O relay só inicia quando o Claude chama a primeira tool

## Desenvolvimento

### Extensão

```bash
cd extension
npm install
npm run dev        # Dev mode com hot reload
npm run build      # Build para produção
npm run test:run   # Rodar testes
```

### Server/MCP

```bash
cd skills/dev-browser
npm install
npm test                          # Testes
npx tsc --noEmit                  # Type check
npx tsx scripts/start-mcp.ts      # Rodar MCP server manualmente
npx tsx scripts/start-relay.ts    # Rodar relay standalone
```

## Créditos

Projeto original: [sawyerhood/dev-browser](https://github.com/sawyerhood/dev-browser) por [Sawyer Hood](https://github.com/sawyerhood)

## Licença

MIT
