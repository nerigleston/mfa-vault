// ===== i18n helper =====
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;

// ===== TOTP (RFC 6238) =====

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error("Invalid Base32 secret");
  let bits = "";
  for (const ch of clean)
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

async function generateTOTP(secretBase32, timestamp = Date.now()) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestamp / 1000 / 30);
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter & 0xffffffff);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, counterBuf),
  );
  const offset = sig[sig.length - 1] & 0x0f;
  const code =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

function secondsRemaining() {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}

// ===== Storage =====
const STORAGE_KEY = "mfa_accounts";
const FOLDERS_KEY = "mfa_folders";
const PRESETS_KEY = "mfa_presets";

async function loadAccounts() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}
async function saveAccounts(list) {
  await chrome.storage.local.set({ [STORAGE_KEY]: list });
}
async function loadFolders() {
  const data = await chrome.storage.local.get(FOLDERS_KEY);
  return data[FOLDERS_KEY] || [];
}
async function saveFolders(list) {
  await chrome.storage.local.set({ [FOLDERS_KEY]: list });
}
async function loadCustomPresets() {
  const data = await chrome.storage.local.get(PRESETS_KEY);
  return data[PRESETS_KEY] || [];
}
async function saveCustomPresets(list) {
  await chrome.storage.local.set({ [PRESETS_KEY]: list });
}

// ===== Site presets =====
const SITE_PRESETS = [
  {
    site: "GitHub",
    urlPattern: "github.com",
    selector: "#app_totp",
    autoSubmit: true,
  },
  {
    site: "AWS Console",
    urlPattern: "signin.aws.amazon.com",
    selector: "#mfaCode",
    autoSubmit: true,
  },
  {
    site: "Notro",
    urlPattern: "hub.notro.io",
    selector: "input[name^=\"verification-code\"]",
    autoSubmit: true,
  },
  {
    site: "Binance",
    urlPattern: "accounts.binance.com",
    selector: "input[data-e2e=\"input-mfa\"]",
    autoSubmit: true,
  },
];

// ===== State =====
let accounts = [];
let folders = [];
let searchQuery = "";
let dragSrcId = null;
let dragSrcFolderId = null;
let collapsedFolders = new Set();
let openRulesPanels = new Set();
let codesHidden = false;

const RING_CIRCUMFERENCE = 94.2;

function getFiltered() {
  if (!searchQuery) return accounts;
  const q = searchQuery.toLowerCase();
  return accounts.filter((a) => a.name.toLowerCase().includes(q));
}

// ===== UI refs =====
const $ = (id) => document.getElementById(id);
const listEl = $("list");
const emptyEl = $("emptyState");
const formEl = $("addForm");
const folderFormEl = $("folderForm");
const toggleAddBtn = $("toggleAdd");
const toggleFolderBtn = $("toggleFolder");
const toggleCodesBtn = $("toggleCodesBtn");
const eyeIcon = $("eyeIcon");
const eyeOffIcon = $("eyeOffIcon");
const exportBtn = $("exportBtn");
const importBtn = $("importBtn");
const importFile = $("importFile");
const saveBtn = $("saveBtn");
const cancelBtn = $("cancelBtn");
const saveFolderBtn = $("saveFolderBtn");
const cancelFolderBtn = $("cancelFolderBtn");
const inputName = $("inputName");
const inputSecret = $("inputSecret");
const inputFolderSel = $("inputFolder");
const inputFolderName = $("inputFolderName");
const formError = $("formError");
const searchWrap = $("searchWrap");
const searchInput = $("searchInput");
const searchClear = $("searchClear");

// ===== Preset menu =====
async function showPresetMenu(anchorEl, onSelect) {
  document.querySelector(".preset-menu")?.remove();

  const customPresets = await loadCustomPresets();
  const allPresets = [...SITE_PRESETS, ...customPresets];

  const menu = document.createElement("div");
  menu.className = "preset-menu";

  if (!allPresets.length) {
    const empty = document.createElement("div");
    empty.className = "preset-menu-empty";
    empty.textContent = t("emptyState");
    menu.appendChild(empty);
  }

  for (const preset of allPresets) {
    const btn = document.createElement("button");
    btn.className = "preset-menu-item";
    btn.textContent = preset.site;
    btn.addEventListener("click", () => {
      menu.remove();
      onSelect(preset);
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = rect.bottom + 4 + "px";
  menu.style.left = rect.left + "px";

  setTimeout(
    () => document.addEventListener("click", () => menu.remove(), { once: true }),
    0,
  );
}

// ===== Rules import / export =====
async function exportRulesList() {
  const customPresets = await loadCustomPresets();
  const all = [...SITE_PRESETS, ...customPresets];
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mfa-vault-sites.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast(t("exportedSites"));
}

async function importRulesList() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error(t("invalidFile"));

      const customPresets = await loadCustomPresets();
      const existingPatterns = new Set([
        ...SITE_PRESETS.map((p) => p.urlPattern),
        ...customPresets.map((p) => p.urlPattern),
      ]);
      const newPresets = data.filter(
        (p) => p.site && p.urlPattern && p.selector && !existingPatterns.has(p.urlPattern),
      );
      await saveCustomPresets([...customPresets, ...newPresets]);
      showToast(t("sitesAdded", newPresets.length));
    } catch (err) {
      showToast(t("genericError", err.message));
    }
  });
  input.click();
}

// ===== Toast =====
function showToast(msg) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1500);
}

// ===== Folder select (in add form) =====
function updateFolderSelect() {
  const current = inputFolderSel.value;
  inputFolderSel.innerHTML = `<option value="">${t("noFolder")}</option>`;
  for (const f of folders) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = "📁 " + f.name;
    inputFolderSel.appendChild(opt);
  }
  if (current && folders.find((f) => f.id === current)) {
    inputFolderSel.value = current;
  }
}

// ===== Empty state =====
function updateEmpty() {
  const hasContent = accounts.length > 0 || folders.length > 0;
  searchWrap.classList.toggle("hidden", !hasContent);

  if (!hasContent) {
    emptyEl.innerHTML = `<span class="empty-icon">🔒</span>${t("emptyState")}`;
    emptyEl.classList.remove("hidden");
  } else if (searchQuery && getFiltered().length === 0) {
    emptyEl.innerHTML = `<span class="empty-icon">🔍</span>Nenhum resultado para <strong>"${searchQuery}"</strong>`;
    emptyEl.classList.remove("hidden");
  } else {
    emptyEl.classList.add("hidden");
  }
}

// ===== Move menu =====
function closeMoveMenu() {
  document.querySelector(".move-menu")?.remove();
}

function showMoveMenu(acc, anchorEl) {
  closeMoveMenu();

  const menu = document.createElement("div");
  menu.className = "move-menu";

  const currentFolderId = acc.folderId || "";

  const makeOption = (label, isActive, onClick) => {
    const btn = document.createElement("button");
    btn.className = "move-menu-item" + (isActive ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    menu.appendChild(btn);
  };

  makeOption(t("noFolder"), currentFolderId === "", async () => {
    const idx = accounts.findIndex((a) => a.id === acc.id);
    if (idx !== -1) delete accounts[idx].folderId;
    await saveAccounts(accounts);
    closeMoveMenu();
    renderList();
    showToast(t("movedNoFolder"));
  });

  for (const folder of folders) {
    makeOption("📁 " + folder.name, currentFolderId === folder.id, async () => {
      const idx = accounts.findIndex((a) => a.id === acc.id);
      if (idx !== -1) accounts[idx].folderId = folder.id;
      await saveAccounts(accounts);
      closeMoveMenu();
      renderList();
      showToast(t("movedToFolder", folder.name));
    });
  }

  document.body.appendChild(menu);

  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = rect.bottom + 4 + "px";
  menu.style.right = window.innerWidth - rect.right + "px";

  setTimeout(
    () => document.addEventListener("click", closeMoveMenu, { once: true }),
    0,
  );
}

// ===== Edit account name inline =====
function startEditAccountName(acc, nameEl, editBtn) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "edit-inline-input";
  input.value = acc.name;

  nameEl.replaceWith(input);
  editBtn.style.display = "none";
  input.focus();
  input.select();

  let saved = false;

  async function save() {
    if (saved) return;
    saved = true;
    const newName = input.value.trim();
    if (newName && newName !== acc.name) {
      const idx = accounts.findIndex((a) => a.id === acc.id);
      if (idx !== -1) accounts[idx].name = newName;
      await saveAccounts(accounts);
    }
    renderList();
  }

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      saved = true;
      renderList();
    }
  });
}

// ===== Edit folder name inline =====
function startEditFolderName(folder, nameEl) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "edit-inline-input folder-name-input";
  input.value = folder.name;

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  let saved = false;

  async function save() {
    if (saved) return;
    saved = true;
    const newName = input.value.trim();
    if (newName && newName !== folder.name) {
      const idx = folders.findIndex((f) => f.id === folder.id);
      if (idx !== -1) folders[idx].name = newName;
      await saveFolders(folders);
      updateFolderSelect();
    }
    renderList();
  }

  input.addEventListener("blur", save);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    }
    if (e.key === "Escape") {
      saved = true;
      renderList();
    }
  });
}

// ===== Create folder header element =====
function createFolderHeader(folder, count) {
  const isCollapsed = collapsedFolders.has(folder.id);

  const header = document.createElement("div");
  header.className = "folder-header";

  header.draggable = true;

  const dragHandle = document.createElement("span");
  dragHandle.className = "folder-drag-handle";
  dragHandle.textContent = "⠿";
  dragHandle.title = "Arrastar para reordenar";

  const chevron = document.createElement("span");
  chevron.className = "folder-chevron" + (isCollapsed ? " collapsed" : "");
  chevron.textContent = "▼";

  const icon = document.createElement("span");
  icon.textContent = "📁";

  const nameSpan = document.createElement("span");
  nameSpan.className = "folder-name";
  nameSpan.textContent = folder.name;

  const countBadge = document.createElement("span");
  countBadge.className = "folder-count";
  countBadge.textContent = count;

  const actions = document.createElement("div");
  actions.className = "folder-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "folder-btn";
  editBtn.textContent = "✏";
  editBtn.title = t("titleRenameFolder");
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startEditFolderName(folder, nameSpan);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "folder-btn danger";
  deleteBtn.textContent = "🗑";
  deleteBtn.title = t("titleRemoveFolder");
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const folderAccCount = accounts.filter(
      (a) => a.folderId === folder.id,
    ).length;
    const msg =
      folderAccCount > 0
        ? t("confirmRemoveFolderAccounts", folder.name, folderAccCount)
        : t("confirmRemoveFolder", folder.name);
    if (!confirm(msg)) return;
    accounts = accounts.map((a) => {
      if (a.folderId !== folder.id) return a;
      const copy = { ...a };
      delete copy.folderId;
      return copy;
    });
    folders = folders.filter((f) => f.id !== folder.id);
    await Promise.all([saveAccounts(accounts), saveFolders(folders)]);
    updateFolderSelect();
    renderList();
    showToast(t("folderRemoved", folder.name));
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  header.addEventListener("click", () => {
    if (collapsedFolders.has(folder.id)) collapsedFolders.delete(folder.id);
    else collapsedFolders.add(folder.id);
    renderList();
  });

  header.addEventListener("dragstart", (e) => {
    dragSrcFolderId = folder.id;
    dragSrcId = null;
    header.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });

  header.addEventListener("dragend", () => {
    header.classList.remove("dragging");
    listEl
      .querySelectorAll(".folder-header")
      .forEach((el) => el.classList.remove("folder-drag-over"));
  });

  header.addEventListener("dragover", (e) => {
    if (!dragSrcFolderId || dragSrcFolderId === folder.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    listEl
      .querySelectorAll(".folder-header")
      .forEach((el) => el.classList.remove("folder-drag-over"));
    header.classList.add("folder-drag-over");
  });

  header.addEventListener("dragleave", (e) => {
    if (!header.contains(e.relatedTarget))
      header.classList.remove("folder-drag-over");
  });

  header.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    header.classList.remove("folder-drag-over");
    if (!dragSrcFolderId || dragSrcFolderId === folder.id) return;

    const fromIdx = folders.findIndex((f) => f.id === dragSrcFolderId);
    const toIdx = folders.findIndex((f) => f.id === folder.id);
    if (fromIdx === -1 || toIdx === -1) return;

    const [moved] = folders.splice(fromIdx, 1);
    folders.splice(toIdx, 0, moved);
    dragSrcFolderId = null;
    await saveFolders(folders);
    await renderList();
  });

  header.appendChild(dragHandle);
  header.appendChild(icon);
  header.appendChild(nameSpan);
  header.appendChild(countBadge);
  header.appendChild(actions);

  return header;
}

// ===== Create account item element =====
function createAccountEl(acc) {
  const el = document.createElement("div");
  el.className = "item";
  el.dataset.id = acc.id;

  const nameRow = document.createElement("div");
  nameRow.className = "item-name-row";

  if (!searchQuery) {
    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.textContent = "⠿";
    handle.title = "Arrastar para reordenar";
    nameRow.appendChild(handle);
  }

  const name = document.createElement("span");
  name.className = "item-name";
  name.textContent = acc.name;
  name.title = acc.name;

  const secretHint = document.createElement("span");
  secretHint.className = "item-secret-hint";
  secretHint.textContent = "···" + acc.secret.slice(-4);
  secretHint.title = "Last 4 chars of the secret";

  const editNameBtn = document.createElement("button");
  editNameBtn.className = "item-btn";
  editNameBtn.textContent = "✏";
  editNameBtn.title = "Editar nome";
  editNameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    startEditAccountName(acc, name, editNameBtn);
  });

  const moveBtn = document.createElement("button");
  moveBtn.className = "item-btn";
  moveBtn.textContent = "📁";
  moveBtn.title = t("titleMoveFolder");
  moveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showMoveMenu(acc, moveBtn);
  });

  const rulesBtn = document.createElement("button");
  const hasRules = acc.siteRules?.length > 0;
  rulesBtn.className = "item-btn" + (hasRules ? " item-btn-rules-on" : "");
  rulesBtn.textContent = "⚙";
  rulesBtn.title = t("titleSettings");

  nameRow.appendChild(name);
  nameRow.appendChild(secretHint);
  nameRow.appendChild(editNameBtn);
  nameRow.appendChild(moveBtn);
  nameRow.appendChild(rulesBtn);

  const code = document.createElement("div");
  code.className = "item-code";
  code.textContent = "--- ---";
  code.title = "Clique para copiar";

  const timerWrap = document.createElement("div");
  timerWrap.className = "item-timer";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 38 38");
  svg.classList.add("timer-svg");

  const bgCircle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  bgCircle.setAttribute("cx", "19");
  bgCircle.setAttribute("cy", "19");
  bgCircle.setAttribute("r", "15");
  bgCircle.classList.add("timer-ring-bg");

  const fgCircle = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "circle",
  );
  fgCircle.setAttribute("cx", "19");
  fgCircle.setAttribute("cy", "19");
  fgCircle.setAttribute("r", "15");
  fgCircle.classList.add("timer-ring-fg");

  svg.appendChild(bgCircle);
  svg.appendChild(fgCircle);

  const timerLabel = document.createElement("div");
  timerLabel.className = "timer-label";

  timerWrap.appendChild(svg);
  timerWrap.appendChild(timerLabel);

  const del = document.createElement("button");
  del.className = "item-delete";
  del.textContent = "✕";
  del.title = t("titleRemoveAccount");
  del.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!confirm(t("confirmRemoveAccount", acc.name))) return;
    accounts = accounts.filter((a) => a.id !== acc.id);
    await saveAccounts(accounts);
    renderList();
  });

  code.addEventListener("click", async () => {
    const rawCode = (code.dataset.totp || code.textContent).replace(/\s/g, "");

    if (acc.siteRules?.length > 0) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url && tab.id) {
          const matchingRule = acc.siteRules.find(
            (r) => r.urlPattern && tab.url.includes(r.urlPattern),
          );
          if (!matchingRule) {
            // URL não bate com nenhuma regra — copia e avisa
            await navigator.clipboard.writeText(rawCode).catch(() => {});
            showToast(t("urlNoRule"));
            return;
          }
          if (matchingRule?.selector) {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: (selector, codeVal, autoSubmit) => {
                // Busca recursiva que atravessa shadow roots
                function deepQueryAll(sel, root) {
                  if (!root) root = document;
                  const results = [];
                  try { [].push.apply(results, root.querySelectorAll(sel)); } catch (e) {}
                  try {
                    const all = root.querySelectorAll("*");
                    for (let i = 0; i < all.length; i++) {
                      if (all[i].shadowRoot) {
                        [].push.apply(results, deepQueryAll(sel, all[i].shadowRoot));
                      }
                    }
                  } catch (e) {}
                  return results;
                }

                const els = deepQueryAll(selector);
                if (!els.length) return false;

                const nativeSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype,
                  "value",
                )?.set;

                function fill(el, val) {
                  el.focus();
                  if (nativeSetter) {
                    nativeSetter.call(el, val);
                  } else {
                    el.value = val;
                  }
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                  el.dispatchEvent(new Event("change", { bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
                }

                if (els.length > 1) {
                  const digits = codeVal.replace(/\s/g, "").split("");
                  els.forEach((el, i) => {
                    if (digits[i] !== undefined) fill(el, digits[i]);
                  });
                } else {
                  fill(els[0], codeVal);
                }

                if (autoSubmit) {
                  const anchor = els[els.length - 1];
                  // getRootNode() retorna o ShadowRoot onde o elemento vive (ou document)
                  const anchorRoot = anchor.getRootNode() || document;
                  function findSubmitBtn() {
                    return (
                      anchor.closest("form")?.querySelector('[type="submit"]') ||
                      anchor.closest("form")?.parentElement?.querySelector("button:not([type='button'])") ||
                      anchorRoot.querySelector('[type="submit"]') ||
                      anchorRoot.querySelector("button:not([type='button']):not([disabled])") ||
                      document.querySelector('[type="submit"]') ||
                      document.querySelector("button[mat-raised-button]") ||
                      document.querySelector("button.bg-primary") ||
                      deepQueryAll('[type="submit"]')[0]
                    );
                  }
                  // Aguarda o botão habilitar (Angular valida o form após os eventos)
                  let attempts = 0;
                  const poll = setInterval(() => {
                    const btn = findSubmitBtn();
                    attempts++;
                    if (btn && !btn.disabled) {
                      clearInterval(poll);
                      btn.click();
                    } else if (attempts >= 20) {
                      clearInterval(poll);
                      if (btn) btn.click(); // tenta mesmo desabilitado
                    }
                  }, 100);
                }

                return true;
              },
              args: [matchingRule.selector, rawCode, matchingRule.autoSubmit === true],
            });
            if (results?.[0]?.result) {
              showToast(t(matchingRule.autoSubmit ? "codeFilledSubmit" : "codeFilled"));
              return;
            }
            // Seletor não encontrou o campo — avisa e copia
            showToast(t("fieldNotFound"));
            await navigator.clipboard.writeText(rawCode).catch(() => {});
            return;
          }
        }
      } catch (err) {
        showToast("⚠ " + (err?.message || t("genericError", "")));
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(rawCode);
      code.classList.add("copied");
      showToast(t("codeCopied"));
      setTimeout(() => code.classList.remove("copied"), 800);
    } catch {
      showToast(t("copyFailed"));
    }
  });

  if (!searchQuery) {
    el.draggable = true;

    el.addEventListener("dragstart", (e) => {
      dragSrcId = acc.id;
      dragSrcFolderId = null;
      el.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    el.addEventListener("dragend", () => {
      el.classList.remove("dragging");
      listEl
        .querySelectorAll(".item")
        .forEach((item) => item.classList.remove("drag-over"));
    });

    el.addEventListener("dragover", (e) => {
      if (!dragSrcId || dragSrcFolderId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragSrcId !== acc.id) {
        listEl
          .querySelectorAll(".item")
          .forEach((item) => item.classList.remove("drag-over"));
        el.classList.add("drag-over");
      }
    });

    el.addEventListener("dragleave", (e) => {
      if (!el.contains(e.relatedTarget)) el.classList.remove("drag-over");
    });

    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      if (!dragSrcId || dragSrcId === acc.id) return;

      const fromIdx = accounts.findIndex((a) => a.id === dragSrcId);
      const toIdx = accounts.findIndex((a) => a.id === acc.id);
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = accounts.splice(fromIdx, 1);
      accounts.splice(toIdx, 0, moved);
      await saveAccounts(accounts);
      await renderList();
    });
  }

  // ===== Rules panel =====
  const rulesPanel = document.createElement("div");
  rulesPanel.className =
    "rules-panel" + (openRulesPanels.has(acc.id) ? "" : " hidden");
  rulesPanel.style.gridColumn = "1 / -1";

  function renderRuleRows() {
    rulesPanel.innerHTML = "";

    const titleRow = document.createElement("div");
    titleRow.className = "rules-title-row";

    const title = document.createElement("div");
    title.className = "rules-title";
    title.textContent = "⚙ " + t("rulesTitle");

    const helpBtn = document.createElement("button");
    helpBtn.className = "rules-help-btn";
    helpBtn.textContent = "?";
    helpBtn.title = "Como configurar um site";
    helpBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lang = chrome.i18n.getUILanguage();
      const helpFile = lang.startsWith("pt") ? "help.html" : "help_en.html";
      chrome.tabs.create({ url: chrome.runtime.getURL(helpFile) });
    });

    titleRow.appendChild(title);
    titleRow.appendChild(helpBtn);
    rulesPanel.appendChild(titleRow);

    const hint = document.createElement("div");
    hint.className = "rules-hint";
    hint.textContent =
      t("urlNoRule");
    rulesPanel.appendChild(hint);

    for (const rule of acc.siteRules || []) {
      const group = document.createElement("div");
      group.className = "rule-group";

      const row = document.createElement("div");
      row.className = "rule-row";

      const urlInput = document.createElement("input");
      urlInput.className = "rule-input";
      urlInput.placeholder = t("placeholderUrl");
      urlInput.value = rule.urlPattern || "";
      urlInput.title = t("placeholderUrl");

      const selInput = document.createElement("input");
      selInput.className = "rule-input";
      selInput.placeholder = t("placeholderSelector");
      selInput.value = rule.selector || "";
      selInput.title = t("placeholderSelector");

      const delBtn = document.createElement("button");
      delBtn.className = "rule-del";
      delBtn.textContent = "✕";
      delBtn.title = t("titleRemoveAccount");

      // Checkbox auto-submit
      const submitRow = document.createElement("label");
      submitRow.className = "rule-submit-row";

      const submitCheck = document.createElement("input");
      submitCheck.type = "checkbox";
      submitCheck.className = "rule-submit-check";
      submitCheck.checked = rule.autoSubmit === true;

      const submitLabel = document.createElement("span");
      submitLabel.textContent = t("autoSubmitLabel");

      submitRow.appendChild(submitCheck);
      submitRow.appendChild(submitLabel);

      async function saveRule() {
        rule.urlPattern = urlInput.value.trim();
        rule.selector = selInput.value.trim();
        rule.autoSubmit = submitCheck.checked;
        const idx = accounts.findIndex((a) => a.id === acc.id);
        if (idx !== -1) accounts[idx].siteRules = acc.siteRules;
        await saveAccounts(accounts);
        rulesBtn.className =
          "item-btn" +
          (acc.siteRules?.length > 0 ? " item-btn-rules-on" : "");
      }

      urlInput.addEventListener("blur", saveRule);
      selInput.addEventListener("blur", saveRule);
      submitCheck.addEventListener("change", saveRule);

      delBtn.addEventListener("click", async () => {
        acc.siteRules = (acc.siteRules || []).filter((r) => r.id !== rule.id);
        const idx = accounts.findIndex((a) => a.id === acc.id);
        if (idx !== -1) accounts[idx].siteRules = acc.siteRules;
        await saveAccounts(accounts);
        rulesBtn.className =
          "item-btn" +
          (acc.siteRules?.length > 0 ? " item-btn-rules-on" : "");
        renderRuleRows();
      });

      row.appendChild(urlInput);
      row.appendChild(selInput);
      row.appendChild(delBtn);
      group.appendChild(row);
      group.appendChild(submitRow);
      rulesPanel.appendChild(group);
    }

    const addRow = document.createElement("div");
    addRow.className = "rules-add-row";

    const addBtn = document.createElement("button");
    addBtn.className = "rule-add-btn";
    addBtn.textContent = t("addRule");
    addBtn.addEventListener("click", () => {
      if (!acc.siteRules) acc.siteRules = [];
      acc.siteRules.push({
        id: crypto.randomUUID(),
        urlPattern: "",
        selector: "",
      });
      renderRuleRows();
      const inputs = rulesPanel.querySelectorAll(".rule-input");
      if (inputs.length >= 2) inputs[inputs.length - 2].focus();
    });

    const presetBtn = document.createElement("button");
    presetBtn.className = "rule-preset-btn";
    presetBtn.textContent = t("knownSite");
    presetBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await showPresetMenu(presetBtn, async (preset) => {
        if (!acc.siteRules) acc.siteRules = [];
        acc.siteRules.push({
          id: crypto.randomUUID(),
          urlPattern: preset.urlPattern,
          selector: preset.selector,
          autoSubmit: preset.autoSubmit ?? false,
        });
        const idx = accounts.findIndex((a) => a.id === acc.id);
        if (idx !== -1) accounts[idx].siteRules = acc.siteRules;
        await saveAccounts(accounts);
        rulesBtn.className = "item-btn item-btn-rules-on";
        renderRuleRows();
      });
    });

    addRow.appendChild(addBtn);
    addRow.appendChild(presetBtn);
    rulesPanel.appendChild(addRow);

    const rulesFooter = document.createElement("div");
    rulesFooter.className = "rules-footer";

    const importLink = document.createElement("button");
    importLink.className = "rules-footer-link";
    importLink.textContent = t("importSites");
    importLink.addEventListener("click", importRulesList);

    const exportLink = document.createElement("button");
    exportLink.className = "rules-footer-link";
    exportLink.textContent = t("exportSites");
    exportLink.addEventListener("click", exportRulesList);

    rulesFooter.appendChild(importLink);
    rulesFooter.appendChild(exportLink);
    rulesPanel.appendChild(rulesFooter);
  }

  renderRuleRows();

  rulesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openRulesPanels.has(acc.id)) {
      openRulesPanels.delete(acc.id);
      rulesPanel.classList.add("hidden");
    } else {
      openRulesPanels.add(acc.id);
      rulesPanel.classList.remove("hidden");
      renderRuleRows();
    }
  });

  el.appendChild(nameRow);
  el.appendChild(rulesPanel);
  el.appendChild(code);
  el.appendChild(timerWrap);
  el.appendChild(del);
  return el;
}

// ===== Render =====
async function renderList() {
  closeMoveMenu();
  listEl.innerHTML = "";
  updateEmpty();

  const isFiltering = searchQuery.length > 0;

  if (isFiltering) {
    for (const acc of getFiltered()) {
      listEl.appendChild(createAccountEl(acc));
    }
  } else {
    for (const folder of folders) {
      const folderAccounts = accounts.filter((a) => a.folderId === folder.id);
      listEl.appendChild(createFolderHeader(folder, folderAccounts.length));

      if (!collapsedFolders.has(folder.id)) {
        for (const acc of folderAccounts) {
          const el = createAccountEl(acc);
          el.classList.add("in-folder");
          listEl.appendChild(el);
        }
      }
    }

    const uncat = accounts.filter((a) => !a.folderId);
    if (folders.length > 0 && uncat.length > 0) {
      const label = document.createElement("div");
      label.className = "section-label";
      label.textContent = t("noFolder").replace("📭 ", "");
      listEl.appendChild(label);
    }
    for (const acc of uncat) {
      listEl.appendChild(createAccountEl(acc));
    }
  }

  await tick();
}

// ===== Tick (update codes & timer rings) =====
async function tick() {
  const secs = secondsRemaining();
  for (const el of listEl.querySelectorAll(".item")) {
    const acc = accounts.find((a) => a.id === el.dataset.id);
    if (!acc) continue;

    const codeEl = el.querySelector(".item-code");
    const ringFg = el.querySelector(".timer-ring-fg");
    const timerLbl = el.querySelector(".timer-label");

    try {
      const totp = await generateTOTP(acc.secret);
      codeEl.dataset.totp = totp;
      codeEl.textContent = codesHidden ? "••• •••" : totp.slice(0, 3) + " " + totp.slice(3);
      codeEl.classList.toggle("hidden-code", codesHidden);
    } catch (err) {
      codeEl.textContent = "ERRO";
      codeEl.title = err.message;
    }

    const offset = RING_CIRCUMFERENCE * (1 - secs / 30);
    ringFg.style.strokeDashoffset = offset;
    timerLbl.textContent = secs + "s";

    const expiring = secs <= 5;
    codeEl.classList.toggle("expiring", expiring);
    ringFg.classList.toggle("expiring", expiring);
  }
}

// ===== Search =====
searchInput.addEventListener("input", () => {
  searchQuery = searchInput.value.trim();
  searchClear.classList.toggle("hidden", searchQuery === "");
  renderList();
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  searchClear.classList.add("hidden");
  searchInput.focus();
  renderList();
});

// ===== Folder form =====
function showFolderForm(show) {
  folderFormEl.classList.toggle("hidden", !show);
  if (show) {
    formEl.classList.add("hidden");
    inputFolderName.value = "";
    inputFolderName.focus();
  }
}

toggleFolderBtn.addEventListener("click", () =>
  showFolderForm(folderFormEl.classList.contains("hidden")),
);
cancelFolderBtn.addEventListener("click", () => showFolderForm(false));

saveFolderBtn.addEventListener("click", async () => {
  const name = inputFolderName.value.trim();
  if (!name) return;
  folders.push({ id: crypto.randomUUID(), name, createdAt: Date.now() });
  await saveFolders(folders);
  updateFolderSelect();
  showFolderForm(false);
  renderList();
  showToast(t("folderCreated", name));
});

inputFolderName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveFolderBtn.click();
  if (e.key === "Escape") showFolderForm(false);
});

// ===== Add form =====
function showForm(show) {
  formEl.classList.toggle("hidden", !show);
  formError.classList.add("hidden");
  if (show) {
    folderFormEl.classList.add("hidden");
    inputName.value = "";
    inputSecret.value = "";
    inputFolderSel.value = "";
    inputName.focus();
  }
}

toggleAddBtn.addEventListener("click", () =>
  showForm(formEl.classList.contains("hidden")),
);
cancelBtn.addEventListener("click", () => showForm(false));

saveBtn.addEventListener("click", async () => {
  const name = inputName.value.trim();
  const secret = inputSecret.value.trim().replace(/\s/g, "").toUpperCase();
  const folderId = inputFolderSel.value || undefined;

  if (!name || !secret) {
    formError.textContent = "Preencha nome e secret.";
    formError.classList.remove("hidden");
    return;
  }

  try {
    await generateTOTP(secret);
  } catch (err) {
    formError.textContent = t("genericError", err.message);
    formError.classList.remove("hidden");
    return;
  }

  const newAcc = {
    id: crypto.randomUUID(),
    name,
    secret,
    createdAt: Date.now(),
  };
  if (folderId) newAcc.folderId = folderId;
  accounts.push(newAcc);
  await saveAccounts(accounts);
  showForm(false);
  await renderList();
});

[inputName, inputSecret].forEach((el) =>
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveBtn.click();
    if (e.key === "Escape") showForm(false);
  }),
);

// ===== Toggle codes visibility =====
toggleCodesBtn.addEventListener("click", () => {
  codesHidden = !codesHidden;
  eyeIcon.classList.toggle("hidden", codesHidden);
  eyeOffIcon.classList.toggle("hidden", !codesHidden);
  toggleCodesBtn.title = t(codesHidden ? "titleShowCode" : "titleHideCode");
  for (const codeEl of listEl.querySelectorAll(".item-code")) {
    const totp = codeEl.dataset.totp;
    if (!totp) continue;
    codeEl.textContent = codesHidden ? "••• •••" : totp.slice(0, 3) + " " + totp.slice(3);
    codeEl.classList.toggle("hidden-code", codesHidden);
  }
});

// ===== Export =====
exportBtn.addEventListener("click", () => {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts,
    folders,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mfa-vault-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(t("exportedBackup"));
});

// ===== Import =====
importBtn.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  importFile.value = "";

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!Array.isArray(data.accounts)) throw new Error(t("invalidFile"));

    const importedAccounts = data.accounts;
    const importedFolders = data.folders || [];
    const total = importedAccounts.length;

    const replace = confirm(
      t("confirmImport", total, file.name),
    );

    function sanitizeAccounts(accs, folderList) {
      const validFolderIds = new Set(folderList.map((f) => f.id));
      return accs.map((a) => {
        if (a.folderId && !validFolderIds.has(a.folderId)) {
          const copy = { ...a };
          delete copy.folderId;
          return copy;
        }
        return a;
      });
    }

    if (replace) {
      folders = importedFolders;
      accounts = sanitizeAccounts(importedAccounts, folders);
    } else {
      const existingFolderIds = new Set(folders.map((f) => f.id));
      const newFolders = importedFolders.filter((f) => !existingFolderIds.has(f.id));
      folders = [...folders, ...newFolders];

      const allFolderIds = new Set(folders.map((f) => f.id));
      const existingIds = new Set(accounts.map((a) => a.id));
      const newAccounts = importedAccounts
        .filter((a) => !existingIds.has(a.id))
        .map((a) => {
          if (a.folderId && !allFolderIds.has(a.folderId)) {
            const copy = { ...a };
            delete copy.folderId;
            return copy;
          }
          return a;
        });

      accounts = [...accounts, ...newAccounts];
      showToast(t("accountsAdded", newAccounts.length));
    }

    await Promise.all([saveAccounts(accounts), saveFolders(folders)]);
    folders.forEach((f) => collapsedFolders.add(f.id));
    updateFolderSelect();
    await renderList();

    if (replace) showToast(t("accountsImported", total));
  } catch (err) {
    showToast(t("importError", err.message));
  }
});

// ===== Init =====
(async () => {
  // Apply i18n to static HTML elements
  $("searchInput").placeholder      = t("placeholderSearch");
  $("inputFolderName").placeholder  = t("placeholderFolderName");
  $("inputName").placeholder        = t("placeholderAccName");
  $("inputSecret").placeholder      = t("placeholderSecret");
  $("saveFolderBtn").textContent    = t("btnCreate");
  $("cancelFolderBtn").textContent  = "✕";
  $("cancelBtn").textContent        = t("btnCancel");
  $("saveBtn").textContent          = t("btnSave");
  $("exportBtn").title              = t("titleExport");
  $("importBtn").title              = t("titleImport");
  $("toggleFolder").title           = t("titleNewFolder");
  $("toggleAdd").title              = t("titleAddAccount");
  toggleCodesBtn.title              = t("titleHideCode");

  [accounts, folders] = await Promise.all([loadAccounts(), loadFolders()]);
  folders.forEach((f) => collapsedFolders.add(f.id));
  updateFolderSelect();
  await renderList();
  setInterval(tick, 1000);
})();
