# MFA Vault — Extensão Chrome

**Em breve no Chrome Web Store:** https://chromewebstore.google.com/detail/mfa-vault/lnahclndpjnkkflekochfdieadamfflh

Extensão Chrome para geração de códigos TOTP/MFA de 6 dígitos (RFC 6238), com **preenchimento automático** nos campos de autenticação dos sites cadastrados.

---

## Instalação

1. Abra `chrome://extensions/`
2. Ative o **Modo Desenvolvedor** (toggle superior direito)
3. Clique em **"Carregar sem compactação"** e selecione a pasta `mfa-extension`
4. Fixe a extensão: ícone 🧩 → pin ao lado de "MFA Vault"

Após qualquer alteração nos arquivos, volte em `chrome://extensions/` e clique em **⟳ Recarregar** no card da extensão.

---

## Funcionalidades

### Códigos TOTP
- Adicione contas com nome e secret Base32 (botão `+`)
- Código de 6 dígitos renovado a cada 30s com timer circular
- Indicador laranja nos últimos 5s de validade
- Clique no código para copiar ou preencher automaticamente

### Backup
- **Exportar** (botão ↓) — baixa um arquivo `mfa-vault-YYYY-MM-DD.json` com todas as contas, pastas e regras
- **Importar** (botão ↑) — carrega um arquivo JSON; escolha entre **Substituir tudo** ou **Mesclar** com o que já existe

### Organização
- **Pastas** — agrupe contas pelo botão 📁 no header
- **Reordenação** — arraste contas e pastas pela alça `⠿`
- **Renomear** — botão ✏ em contas e pastas
- **Mover pasta** — botão 📁 na linha da conta
- **Busca** — filtra contas por nome em tempo real

### Preenchimento automático
- Clique no **⚙** de uma conta para abrir o painel de regras
- **?** — abre o guia completo em nova aba (como encontrar URL Pattern e Seletor CSS, com prompt pronto para usar com IA)
- **+ Adicionar regra** — preencha URL e seletor CSS manualmente
- **↙ Site conhecido** — aplica um preset pronto (GitHub, AWS, Notro, Binance e sites importados)
- Marque **"Enviar formulário após preencher"** para submeter o login automaticamente (aguarda o botão habilitar por até 2s, compatível com Angular)
- Ao clicar no código com a aba do site aberta, o campo MFA é preenchido (e opcionalmente enviado)
- Se o campo não for encontrado, o código é copiado para a área de transferência
- O botão ⚙ fica roxo e sempre visível quando a conta tem regras configuradas

### Lista de sites (presets)
- **↑ Importar lista de sites** — adiciona presets de um JSON compartilhado pelo time
- **↓ Exportar lista de sites** — baixa `mfa-vault-sites.json` com todos os presets (embutidos + importados)

**Formato do arquivo de lista de sites:**
```json
[
  { "site": "Nome do site", "urlPattern": "dominio.com", "selector": "#campo-mfa", "autoSubmit": true }
]
```

---

## Sites configurados

| Site | URL | Seletor CSS | Tipo de campo |
|------|-----|-------------|---------------|
| GitHub | `github.com` | `#app_totp` | Input único |
| AWS | `signin.aws.amazon.com` | `#mfaCode` | Input único |
| Notro | `hub.notro.io` | `input[name^="verification-code"]` | 6 campos separados |
| Binance | `accounts.binance.com` | `input[data-e2e="input-mfa"]` | Input único (shadow DOM) |

---

## Como adicionar um novo site

### 1. Identifique o seletor CSS do campo MFA

Abra a página de login com o campo MFA visível, clique com o botão direito no campo e escolha **Inspecionar**. Localize o `<input>` e anote seu seletor.

Ou compartilhe o HTML do trecho com o campo no chat para receber o seletor pronto.

**Exemplos de seletores comuns:**
```
#app_totp
input[name="otp"]
input[type="text"][autocomplete="one-time-code"]
input[name^="verification-code"]    ← múltiplos campos (1 dígito cada)
```

### 2. Identifique o tipo de campo

| Tipo | Descrição | Seletor |
|------|-----------|---------|
| **Input único** | Um `<input>` que recebe os 6 dígitos | Seletor do elemento |
| **Inputs separados** | 6 `<input maxlength="1">`, um dígito por campo | Seletor que capture os 6 (ex: `input[name^="prefix"]`) |

A extensão detecta automaticamente: se o seletor retornar mais de um elemento, distribui os dígitos um por campo.

### 3. Cadastre a regra na extensão

1. Clique em **⚙** na conta correspondente
2. Clique em **+ Adicionar regra**
3. Preencha:
   - **URL** — trecho do endereço da página (ex: `meusite.com.br`)
   - **Seletor CSS** — o seletor identificado acima
4. Clique fora do campo para salvar

### 4. Interprete o toast de retorno

| Mensagem | Significado |
|----------|-------------|
| `✓ Código preenchido!` | Funcionou (sem auto-submit) |
| `✓ Preenchido — enviando...` | Funcionou e clicou no botão de envio |
| `URL sem regra — copiado` | A URL da aba não contém o padrão cadastrado — verifique o campo URL na regra |
| `Campo não encontrado — copiado` | Seletor CSS não encontrou o elemento — verifique o seletor |
| `⚠ <mensagem de erro>` | Erro de permissão — recarregue a extensão em `chrome://extensions` |
| `Código copiado!` | A conta não tem regras configuradas no ⚙ |

---

## Estrutura do projeto

```
mfa-extension/
├── manifest.json     # Manifest V3 — permissões e metadados
├── popup.html        # Estrutura estática da UI
├── popup.css         # Tema escuro com variáveis CSS
├── popup.js          # Toda a lógica: TOTP, storage, UI, auto-fill
├── CLAUDE.md         # Contexto técnico para desenvolvimento com IA
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Armazenamento

Os dados ficam em `chrome.storage.local` — apenas no perfil local do Chrome, sem sincronização entre dispositivos. Os secrets são armazenados em texto puro (padrão de apps autenticadores locais).

Para inspecionar via console:
```
chrome://extensions → MFA Vault → Inspecionar → Console
> chrome.storage.local.get(null, console.log)
```

---

## Notas técnicas

- TOTP implementado com `crypto.subtle` nativo (HMAC-SHA1, janela de 30s, 6 dígitos)
- Sem dependências externas — apenas APIs nativas do Chrome e Web
- Compatível com inputs nativos, React (native value setter) e Angular (eventos `input`/`change`/`keyup`)
- `host_permissions: <all_urls>` é necessário para injetar o script de preenchimento em qualquer domínio
