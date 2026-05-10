# MFA Vault — Contexto técnico

Extensão Chrome (Manifest V3) para geração e preenchimento automático de códigos TOTP/MFA.

## Stack

- Vanilla JS (sem frameworks, sem bundler)
- `crypto.subtle` para HMAC-SHA1 (TOTP RFC 6238)
- `chrome.storage.local` para persistência
- `chrome.scripting.executeScript` + `chrome.tabs` para auto-fill

## Arquivos principais

| Arquivo | Responsabilidade |
|---------|-----------------|
| `manifest.json` | Permissões MV3: `storage`, `activeTab`, `scripting`, `tabs`, `host_permissions: <all_urls>` |
| `popup.js` | Toda a lógica: TOTP, storage, render da lista, drag-and-drop, busca, regras de auto-fill |
| `popup.html` | Estrutura estática mínima — UI gerada dinamicamente em JS |
| `popup.css` | Tema escuro, variáveis CSS, sem pré-processador |

## Estrutura de dados (chrome.storage.local)

### `mfa_accounts` — array de contas

```js
[
  {
    id: "uuid",
    name: "GitHub - user@email.com",
    secret: "BASE32SECRET",
    createdAt: 1234567890,
    folderId: "uuid-opcional",
    siteRules: [              // opcional
      {
        id: "uuid",
        urlPattern: "github.com",   // substring da tab.url
        selector: "#app_totp",      // seletor CSS do campo MFA
        autoSubmit: true            // clicar no botão submit após preencher
      }
    ]
  }
]
```

### `mfa_folders` — array de pastas

```js
[
  { id: "uuid", name: "Trabalho", createdAt: 1234567890 }
]
```

## State global (popup.js)

```js
let accounts = [];          // array de contas carregadas do storage
let folders = [];           // array de pastas
let searchQuery = "";       // string de busca atual
let dragSrcId = null;       // id da conta sendo arrastada
let dragSrcFolderId = null; // id da pasta sendo arrastada
let collapsedFolders = new Set();  // pastas recolhidas
let openRulesPanels = new Set();   // contas com painel ⚙ aberto
```

## Fluxo de auto-fill

1. Usuário clica no código TOTP
2. Se a conta tem `siteRules.length > 0`:
   - `chrome.tabs.query({ active: true, currentWindow: true })` → pega a aba atual
   - Procura regra cujo `urlPattern` está contido em `tab.url`
   - Se **nenhuma regra bate**: copia + toast `"URL sem regra — copiado"`
   - Se encontrou: `chrome.scripting.executeScript` injeta função na aba
   - Função injetada usa `deepQueryAll(selector)` — busca recursiva que atravessa shadow roots:
     - **1 elemento** → preenche o valor inteiro (GitHub, AWS, Binance, etc.)
     - **N elementos** → distribui 1 dígito por campo (Notro, Angular split-input)
   - Dispara eventos `input`, `change`, `keyup` para compatibilidade com React/Angular
   - React: usa `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`
   - Shadow DOM: `deepQueryAll` percorre recursivamente todos os `el.shadowRoot` para suportar Web Components (ex: Binance usa shadow root no modal MFA)
   - Se `autoSubmit === true`: após preencher, faz polling a cada 100ms (até 2s) esperando o botão de submit habilitar. Ordem de busca: `[type="submit"]` no form → botão no pai do form → `anchorRoot.querySelector(...)` (mesmo shadow root do input) → `[type="submit"]` na página → `button[mat-raised-button]` → `button.bg-primary` → `deepQueryAll('[type="submit"]')[0]`. Necessário para Angular (botão fica `disabled` até a validação do form passar)
   - Se `result === false` (elemento não encontrado): copia + toast `"Campo não encontrado — copiado"`
   - Se `executeScript` lança exceção: toast `"⚠ <mensagem>"` e retorna sem copiar
3. Se a conta não tem regras → copia + toast `"Código copiado!"`

## Toasts de diagnóstico

| Toast | Causa |
|-------|-------|
| `✓ Código preenchido!` | Auto-fill funcionou (sem auto-submit) |
| `✓ Preenchido — enviando...` | Auto-fill + submit ativado |
| `URL sem regra — copiado` | URL da aba não bate com nenhum `urlPattern` |
| `Campo não encontrado — copiado` | Seletor CSS não encontrou o elemento |
| `⚠ <mensagem>` | Exceção no `executeScript` (ex: permissão negada) |
| `Código copiado!` | Conta sem regras configuradas |

## Presets de sites

**Embutidos** (`SITE_PRESETS` array em `popup.js`):

| Site | urlPattern | selector | autoSubmit |
|------|-----------|----------|------------|
| GitHub | `github.com` | `#app_totp` | true |
| AWS Console | `signin.aws.amazon.com` | `#mfaCode` | true |
| Notro | `hub.notro.io` | `input[name^="verification-code"]` | true |
| Binance | `accounts.binance.com` | `input[data-e2e="input-mfa"]` | true |

**Custom presets**: armazenados em `chrome.storage.local` (`mfa_presets`). Importados via "↑ Importar lista de sites" no painel ⚙. Exportados junto com os embutidos via "↓ Exportar lista de sites".

**Formato do JSON de lista de sites:**
```json
[
  { "site": "Nome", "urlPattern": "dominio.com", "selector": "#campo", "autoSubmit": true }
]
```

Import: adiciona apenas presets com `urlPattern` novo (não duplica embutidos nem custom já existentes).

## Sites cadastrados

| Site | URL pattern | Seletor | Tipo |
|------|-------------|---------|------|
| GitHub | `github.com` | `#app_totp` | Input único |
| AWS Console | `signin.aws.amazon.com` | `#mfaCode` | Input único |
| Notro | `hub.notro.io` | `input[name^="verification-code"]` | 6 campos separados |
| Binance | `accounts.binance.com` | `input[data-e2e="input-mfa"]` | Input único (shadow DOM) |

> O HTML de 6 campos Angular que o usuário enviou inicialmente era de um fluxo AWS diferente (SSO/Identity Center). O console padrão (`signin.aws.amazon.com`) usa um único `<input id="mfaCode" name="mfaCode" autocomplete="one-time-code">` gerado pelo Cloudscape UI.
>
> O campo MFA da Binance está dentro de shadow DOM (`deepQuery` no console retorna o elemento, `document.querySelector` retorna null). O seletor `input[data-e2e="input-mfa"]` usa atributo `data-e2e` mantido estável pelo time de QA da Binance. O `id="bn-formItem-XXXX"` é gerado dinamicamente e não deve ser usado.

## Como adicionar suporte a um novo site

1. Usuário cola o HTML do campo MFA no chat
2. Identificar o seletor CSS mais estável (preferir `id` > `name` > atributos semânticos > classes)
3. Identificar o tipo:
   - **Input único**: `<input>` que recebe os 6 dígitos → seletor direto do elemento
   - **Split inputs**: múltiplos `<input maxlength="1">` → seletor que capture todos (ex: `input[name^="prefix"]`)
4. Informar o par `{ urlPattern, selector }` para o usuário cadastrar via painel ⚙

## Export / Import

**Formato do arquivo de backup:**
```json
{
  "version": 1,
  "exportedAt": "2026-05-09T...",
  "accounts": [...],
  "folders": [...]
}
```

- **Export**: serializa `accounts` + `folders` em JSON e faz download via `URL.createObjectURL`
- **Import**: lê o arquivo, valida `Array.isArray(data.accounts)`, pergunta via `confirm()`:
  - **OK (Substituir)**: sobrescreve `accounts` e `folders` inteiros
  - **Cancelar (Mesclar)**: filtra por `id` e adiciona apenas contas/pastas novas
- `sanitizeAccounts(accs, folderList)`: remove `folderId` de contas que referenciam pastas inexistentes, evitando contas invisíveis na lista

## Página de ajuda (`help.html` + `help.js`)

> MV3 bloqueia scripts inline e `onclick` em páginas de extensão (CSP: `script-src 'self'`). Todo JavaScript da help page deve ficar em `help.js` (externo), nunca inline.

## Página de ajuda (`help.html`)

Página standalone (abre em nova aba via `chrome.tabs.create`) com tutorial completo sobre como configurar um site novo. Acessada pelo botão `?` no título do painel ⚙.

Cobre:
1. O que é URL Pattern e Seletor CSS
2. Como encontrar a URL Pattern (barra de endereços)
3. Como encontrar o Seletor CSS (DevTools → Inspecionar → ler atributos `id`/`name`)
4. Tabela de prioridade de seletores (id > name > autocomplete > placeholder > class)
5. Diferença entre input único e 6 campos separados (split)
6. Exemplos dos sites configurados (GitHub, AWS, Notro)
7. Alternativa via IA: copiar outerHTML → usar prompt pronto (copiável com botão) → aplicar resultado na extensão

## Padrões do código

- `createAccountEl(acc)` — cria o elemento DOM completo de uma conta (inclui código, timer, botões, painel de regras)
- `renderList()` — re-renderiza a lista inteira; chama `tick()` no final
- `tick()` — atualiza códigos TOTP e o anel SVG de timer para todos os itens visíveis
- `showToast(msg)` — toast temporário de 1.5s
- Salvar sempre via `saveAccounts(accounts)` ou `saveFolders(folders)` (gravam no storage e atualizam o array em memória)

## Recarregar após mudanças

```
chrome://extensions → MFA Vault → ⟳ Recarregar
```

Não há build step — editar os arquivos e recarregar é suficiente.
