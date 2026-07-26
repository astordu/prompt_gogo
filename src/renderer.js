// Global state
let currentEditingId = null;
let shortcuts = [];
let providers = [];
let currentEditingProviderId = null;

// DOM elements
const addShortcutBtn = document.getElementById('add-shortcut-btn');
const shortcutsTableBody = document.getElementById('shortcuts-table-body');
const emptyState = document.getElementById('empty-state');

const promptModal = document.getElementById('prompt-modal');
const modalTitle = document.getElementById('modal-title');
const closeModalBtn = document.getElementById('close-modal');
const cancelModalBtn = document.getElementById('cancel-modal');
const savePromptBtn = document.getElementById('save-prompt');

const promptNameInput = document.getElementById('prompt-name');
const keyboardShortcutInput = document.getElementById('keyboard-shortcut');
const shortcutAvailabilityStatus = document.getElementById('shortcut-availability-status');
const promptTemplateInput = document.getElementById('prompt-template');
const templateError = document.getElementById('template-error');
const shortcutProviderSelect = document.getElementById('shortcut-provider');
const shortcutProviderEmpty = document.getElementById('shortcut-provider-empty');

// --- Shortcut availability check state ---
// Tracks the latest check request so stale async results don't overwrite newer ones.
let shortcutCheckToken = 0;
// Cached result of the latest availability check for the current draft accelerator.
let lastAvailabilityResult = null;

const MODIFIER_NAMES = {
  'Control': { symbol: '⌃', label: 'Control' },
  'Command': { symbol: '⌘', label: 'Command' },
  'CommandOrControl': { symbol: '⌘', label: 'Command' },
  'Alt': { symbol: '⌥', label: 'Option' },
  'Shift': { symbol: '⇧', label: 'Shift' },
};

function formatAcceleratorForDisplay(accelerator) {
  const parts = accelerator.split('+');
  return parts.map(part => {
    const mod = MODIFIER_NAMES[part];
    if (mod) {
      return `<kbd class="px-2 py-1.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-md" aria-label="${mod.label}">${mod.symbol}</kbd>`;
    }
    return `<kbd class="px-2 py-1.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-md" aria-label="${part}">${part}</kbd>`;
  }).join(' ');
}

function isModifierOnly(part) {
  return ['Control', 'Command', 'CommandOrControl', 'Alt', 'Shift'].includes(part);
}

function isValidShortcutFormat(accelerator) {
  if (!accelerator) return false;
  const parts = accelerator.split('+');
  const modifiers = parts.filter(isModifierOnly);
  const nonModifiers = parts.filter(p => !isModifierOnly(p));
  return modifiers.length >= 2 && nonModifiers.length >= 1;
}

function showAvailabilityStatus(type, message) {
  shortcutAvailabilityStatus.classList.remove('hidden', 'text-success', 'text-danger', 'text-text-secondary-light', 'dark:text-text-secondary-dark');
  switch (type) {
    case 'checking':
      shortcutAvailabilityStatus.className = 'text-sm mt-2 text-text-secondary-light dark:text-text-secondary-dark';
      break;
    case 'available':
      shortcutAvailabilityStatus.className = 'text-sm mt-2 text-success';
      break;
    case 'invalid':
    case 'internal-conflict':
    case 'external-conflict':
      shortcutAvailabilityStatus.className = 'text-sm mt-2 text-danger';
      break;
    case 'unavailable':
      shortcutAvailabilityStatus.className = 'text-sm mt-2 text-text-secondary-light dark:text-text-secondary-dark';
      break;
  }
  shortcutAvailabilityStatus.textContent = message;
}

function hideAvailabilityStatus() {
  shortcutAvailabilityStatus.classList.add('hidden');
  shortcutAvailabilityStatus.textContent = '';
}

async function checkShortcutAvailability(accelerator, excludeId) {
  const token = ++shortcutCheckToken;

  if (!accelerator || !accelerator.trim()) {
    hideAvailabilityStatus();
    lastAvailabilityResult = null;
    return null;
  }

  if (!isValidShortcutFormat(accelerator)) {
    showAvailabilityStatus('invalid', '无效组合：至少需要两个修饰键（Control / Option / Shift / Command）加一个普通键。');
    lastAvailabilityResult = { status: 'invalid' };
    return { status: 'invalid' };
  }

  showAvailabilityStatus('checking', '正在检测…');

  let result;
  try {
    result = await window.electronAPI.checkShortcutAvailability(accelerator, excludeId);
  } catch {
    result = { status: 'unavailable' };
  }

  // Stale check — a newer recording has started, discard this result
  if (token !== shortcutCheckToken) return null;

  lastAvailabilityResult = result;

  switch (result.status) {
    case 'available':
      showAvailabilityStatus('available', '✓ 当前可用');
      break;
    case 'internal-conflict':
      showAvailabilityStatus('internal-conflict', `✗ 与已有快捷键「${result.conflictWith}」重复`);
      break;
    case 'external-conflict':
      showAvailabilityStatus('external-conflict', '✗ 可能被 macOS 或其他应用占用');
      break;
    case 'unavailable':
      showAvailabilityStatus('unavailable', '暂时无法检测，请点击重新检测');
      break;
    default:
      showAvailabilityStatus('invalid', '无效组合：至少需要两个修饰键加一个普通键。');
      break;
  }

  return result;
}

const macPermissionToggle = document.getElementById('mac-permission-toggle');
const macPermissionContent = document.getElementById('mac-permission-content');
const macPermissionIcon = document.getElementById('mac-permission-icon');

// --- Template chip editor (contenteditable + atomic chips) ---

function createChip(varName) {
  const chip = document.createElement('span');
  chip.contentEditable = false;
  chip.className = 'template-chip';
  chip.dataset.variable = varName;
  chip.textContent = '@' + varName;
  return chip;
}

function setTemplateEditor(text) {
  promptTemplateInput.innerHTML = '';
  const nodes = templateModule.parseTemplate(text);
  for (const node of nodes) {
    if (node.type === 'text') {
      promptTemplateInput.appendChild(document.createTextNode(node.value));
    } else {
      promptTemplateInput.appendChild(createChip(node.value));
    }
  }
}

function domToNodes(element) {
  const nodes = [];
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      nodes.push({ type: 'text', value: child.textContent });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.dataset && child.dataset.variable !== undefined) {
        nodes.push({ type: 'variable', value: child.dataset.variable });
      } else if (child.tagName === 'BR') {
        nodes.push({ type: 'text', value: '\n' });
      } else {
        const isBlock = child.tagName === 'DIV' || child.tagName === 'P';
        if (isBlock && nodes.length > 0) {
          const last = nodes[nodes.length - 1];
          if (!(last.type === 'text' && last.value.endsWith('\n'))) {
            nodes.push({ type: 'text', value: '\n' });
          }
        }
        nodes.push(...domToNodes(child));
      }
    }
  }
  return nodes;
}

function getTemplateText() {
  const nodes = domToNodes(promptTemplateInput);
  return templateModule.serializeTemplate(nodes);
}

// --- Paste recognition ---

function insertNodesAtCaret(nodes) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();

  // Build a DocumentFragment from parsed nodes, inserting in reverse so we
  // can reuse the same collapsed range insertion point each time.
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === 'variable') {
      frag.appendChild(createChip(node.value));
    } else if (node.value) {
      frag.appendChild(document.createTextNode(node.value));
    }
  }
  const lastChild = frag.lastChild;
  range.insertNode(frag);

  // Move caret to end of inserted content
  if (lastChild) {
    const after = document.createRange();
    after.setStartAfter(lastChild);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
}

function handlePaste(e) {
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  const nodes = templateModule.parseTemplate(text);
  insertNodesAtCaret(nodes);
}

promptTemplateInput.addEventListener('paste', handlePaste);

// --- Manual input recognition ---

function convertTextNodesToChips() {
  // Collect text nodes that contain at least one variable pattern
  const sel = window.getSelection();
  const caretNode = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null;
  const caretOffset = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startOffset : 0;

  // Walk all text nodes inside the editor
  const walker = document.createTreeWalker(
    promptTemplateInput,
    NodeFilter.SHOW_TEXT,
    null
  );

  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  let newCaretNode = caretNode;
  let newCaretOffset = caretOffset;

  for (const textNode of textNodes) {
    const parsed = templateModule.parseTemplate(textNode.textContent);
    // Only replace if there is at least one variable node in the result
    if (!parsed.some(n => n.type === 'variable')) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;

    // Determine caret offset relative to this text node before we replace it
    const isCaretNode = textNode === caretNode;
    let offsetBeforeCaret = isCaretNode ? caretOffset : 0;

    // Build replacement nodes
    const replacements = [];
    let charCount = 0;
    for (const part of parsed) {
      if (part.type === 'variable') {
        const chip = createChip(part.value);
        replacements.push(chip);
        const tokenLen = 1 + part.value.length; // '@' + name
        if (isCaretNode && charCount + tokenLen <= offsetBeforeCaret) {
          // Caret was inside or after this token — place it after the chip
          newCaretNode = chip;
          newCaretOffset = 1; // after the chip element
        }
        charCount += tokenLen;
      } else {
        const tn = document.createTextNode(part.value);
        replacements.push(tn);
        if (isCaretNode && charCount <= offsetBeforeCaret && charCount + part.value.length >= offsetBeforeCaret) {
          newCaretNode = tn;
          newCaretOffset = offsetBeforeCaret - charCount;
        }
        charCount += part.value.length;
      }
    }

    // Insert replacements before the original text node, then remove it
    for (const repl of replacements) {
      parent.insertBefore(repl, textNode);
    }
    parent.removeChild(textNode);
  }

  // Restore caret
  if (sel && newCaretNode && newCaretNode !== caretNode) {
    try {
      const newRange = document.createRange();
      if (newCaretNode.nodeType === Node.ELEMENT_NODE) {
        newRange.setStartAfter(newCaretNode);
      } else {
        newRange.setStart(newCaretNode, Math.min(newCaretOffset, newCaretNode.textContent.length));
      }
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
    } catch (_) {
      // Ignore caret restore failures — content is still correct
    }
  }
}

promptTemplateInput.addEventListener('input', () => {
  const hasChip = promptTemplateInput.querySelector('.template-chip');
  if (!hasChip && !promptTemplateInput.textContent.trim()) {
    promptTemplateInput.innerHTML = '';
  }
  if (!menuVisible) {
    convertTextNodesToChips();
  }
  handleCompletionInput();
});

// --- Completion Menu ---

const completionMenu = document.getElementById('completion-menu');
let menuVisible = false;
let highlightedIndex = 0;
let filteredVars = [];

function getAtQueryFromCaret() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent.slice(0, range.startOffset);
  const atIdx = text.lastIndexOf('@');
  if (atIdx === -1) return null;

  const query = text.slice(atIdx + 1);
  // Only trigger if there's no space or newline in the query (since @ must be the last word start)
  if (/[\s]/.test(query)) return null;

  return { node, offset: atIdx, query };
}

function showCompletionMenu(anchorRect, query) {
  const allVars = templateModule.VARIABLES;
  filteredVars = allVars.filter(v => v.name.startsWith(query.toLowerCase()));

  if (filteredVars.length === 0) {
    hideCompletionMenu();
    return;
  }

  highlightedIndex = 0;
  renderMenuItems();

  // Position below caret
  const menuEl = completionMenu;
  menuEl.classList.remove('hidden');
  menuVisible = true;

  // Place below the anchor rect, but keep within viewport
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;
  const menuH = menuEl.offsetHeight;
  const menuW = menuEl.offsetWidth;

  let top = anchorRect.bottom + 4;
  let left = anchorRect.left;

  if (top + menuH > viewportH) top = anchorRect.top - menuH - 4;
  if (left + menuW > viewportW) left = viewportW - menuW - 8;

  menuEl.style.top = top + 'px';
  menuEl.style.left = left + 'px';
}

function hideCompletionMenu() {
  completionMenu.classList.add('hidden');
  menuVisible = false;
  filteredVars = [];
  highlightedIndex = 0;
}

function renderMenuItems() {
  completionMenu.innerHTML = filteredVars.map((v, i) => {
    const isHighlighted = i === highlightedIndex;
    const bgClass = isHighlighted
      ? 'bg-primary/10 dark:bg-primary/20'
      : 'hover:bg-background-light dark:hover:bg-background-dark';
    return `<div class="completion-item ${bgClass}" data-var="${v.name}" data-index="${i}">
      <span class="completion-item-name text-primary">${v.name}</span>
      <span class="completion-item-desc text-text-secondary-light dark:text-text-secondary-dark">${v.description}</span>
    </div>`;
  }).join('');

  completionMenu.querySelectorAll('.completion-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault(); // prevent editor blur
      const varName = el.dataset.var;
      confirmSelection(varName);
    });
  });
}

function confirmSelection(varName) {
  const info = getAtQueryFromCaret();
  if (!info) {
    hideCompletionMenu();
    return;
  }

  const { node, offset } = info;
  // Delete from @ to caret
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, window.getSelection().getRangeAt(0).startOffset);

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  range.deleteContents();

  // Insert chip at cursor
  const chip = createChip(varName);
  range.insertNode(chip);

  // Move caret after chip
  const after = document.createRange();
  after.setStartAfter(chip);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);

  hideCompletionMenu();
}

function handleCompletionInput() {
  const info = getAtQueryFromCaret();
  if (!info) {
    hideCompletionMenu();
    return;
  }

  // Get bounding rect of the @ character for menu positioning
  const { node, offset } = info;
  const range = document.createRange();
  range.setStart(node, offset);
  range.setEnd(node, offset + 1);
  const rect = range.getBoundingClientRect();
  // If @ isn't rendered (offset at text length), fall back to caret rect
  const anchorRect = rect.width > 0 ? rect : window.getSelection().getRangeAt(0).getBoundingClientRect();

  showCompletionMenu(anchorRect, info.query);
}

promptTemplateInput.addEventListener('keydown', (e) => {
  if (!menuVisible) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightedIndex = (highlightedIndex + 1) % filteredVars.length;
    renderMenuItems();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightedIndex = (highlightedIndex - 1 + filteredVars.length) % filteredVars.length;
    renderMenuItems();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    confirmSelection(filteredVars[highlightedIndex].name);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideCompletionMenu();
  }
});

// Hide menu when editor loses focus (but not on mousedown inside menu — handled by e.preventDefault())
promptTemplateInput.addEventListener('blur', () => {
  // Small delay so mousedown on menu item fires first
  setTimeout(hideCompletionMenu, 150);
});

// Initialize
async function init() {
  const config = await window.electronAPI.getConfig();

  // Load providers
  providers = config.providers || [];
  renderProviders();

  // Load shortcuts
  shortcuts = config.shortcuts || [];
  renderShortcuts();
}

// Mac Permission Guide Toggle
macPermissionToggle.addEventListener('click', () => {
  const isHidden = macPermissionContent.classList.contains('hidden');
  
  if (isHidden) {
    macPermissionContent.classList.remove('hidden');
    macPermissionIcon.style.transform = 'rotate(180deg)';
  } else {
    macPermissionContent.classList.add('hidden');
    macPermissionIcon.style.transform = 'rotate(0deg)';
  }
});

// ─── Provider Management ───────────────────────────────────────────────────────

const addProviderBtn = document.getElementById('add-provider-btn');
const providersTableBody = document.getElementById('providers-table-body');
const providersEmptyState = document.getElementById('providers-empty-state');
const providerModal = document.getElementById('provider-modal');
const providerModalTitle = document.getElementById('provider-modal-title');
const closeProviderModalBtn = document.getElementById('close-provider-modal');
const cancelProviderModalBtn = document.getElementById('cancel-provider-modal');
const saveProviderBtn = document.getElementById('save-provider-btn');
const providerNameInput = document.getElementById('provider-name');
const providerTypeSelect = document.getElementById('provider-type');
const providerApikeyField = document.getElementById('provider-apikey-field');
const providerApikeyInput = document.getElementById('provider-apikey');
const providerApikeyHint = document.getElementById('provider-apikey-hint');
const providerBaseurlField = document.getElementById('provider-baseurl-field');
const providerBaseurlInput = document.getElementById('provider-baseurl');
const providerModelSelect = document.getElementById('provider-model-select');
const providerModelInput = document.getElementById('provider-model-input');
const providerOllamaModelSelect = document.getElementById('provider-ollama-model-select');
const providerOllamaModelStatus = document.getElementById('provider-ollama-model-status');
const verifyProviderBtn = document.getElementById('verify-provider-btn');
const verifyProviderStatus = document.getElementById('verify-provider-status');

const TYPE_LABELS = { deepseek: 'DeepSeek', ollama: 'Ollama', custom: 'Custom' };

function renderProviders() {
  if (providers.length === 0) {
    providersEmptyState.classList.remove('hidden');
    providersTableBody.innerHTML = '';
    return;
  }

  providersEmptyState.classList.add('hidden');

  providersTableBody.innerHTML = providers.map(p => `
    <tr class="border-b border-border-light dark:border-border-dark last:border-b-0">
      <td class="px-6 py-4 text-text-primary-light dark:text-text-primary-dark font-medium">${escapeHtml(p.name)}</td>
      <td class="px-6 py-4">
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary dark:bg-primary/20">${escapeHtml(TYPE_LABELS[p.type] || p.type)}</span>
      </td>
      <td class="px-6 py-4 text-text-secondary-light dark:text-text-secondary-dark font-mono text-sm">${escapeHtml(p.model || '')}</td>
      <td class="px-6 py-4 text-right">
        <div class="flex justify-end gap-4">
          <button class="provider-edit-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-primary dark:hover:text-primary" data-id="${p.id}">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="provider-delete-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-danger dark:hover:text-danger" data-id="${p.id}">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  document.querySelectorAll('.provider-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      editProvider(e.currentTarget.getAttribute('data-id'));
    });
  });

  document.querySelectorAll('.provider-delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      deleteProvider(e.currentTarget.getAttribute('data-id'));
    });
  });
}

async function fetchOllamaModels(currentModel) {
  const baseUrl = (providerBaseurlInput.value.trim() || 'http://localhost:11434').replace(/\/$/, '');
  providerModelInput.classList.add('hidden');
  providerOllamaModelSelect.classList.add('hidden');
  providerOllamaModelStatus.classList.remove('hidden');
  providerOllamaModelStatus.textContent = '正在获取模型列表...';

  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map(m => m.name).filter(Boolean);
    if (models.length === 0) throw new Error('未发现已安装模型');

    providerOllamaModelSelect.innerHTML = models.map(m =>
      `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`
    ).join('');
    if (currentModel && models.includes(currentModel)) {
      providerOllamaModelSelect.value = currentModel;
    }
    providerOllamaModelSelect.classList.remove('hidden');
    providerOllamaModelStatus.classList.add('hidden');
  } catch {
    providerModelInput.classList.remove('hidden');
    providerModelInput.placeholder = '例如：llama3.2';
    providerOllamaModelStatus.textContent = '无法连接 Ollama，可手动输入模型名';
  }
}

function getOllamaModel() {
  if (!providerOllamaModelSelect.classList.contains('hidden')) {
    return providerOllamaModelSelect.value;
  }
  return providerModelInput.value.trim();
}

function updateProviderFormFields(type, currentModel) {
  providerOllamaModelStatus.classList.add('hidden');
  providerOllamaModelSelect.classList.add('hidden');
  if (type === 'deepseek') {
    providerApikeyField.classList.remove('hidden');
    providerApikeyHint.classList.add('hidden');
    providerBaseurlField.classList.add('hidden');
    providerModelSelect.classList.remove('hidden');
    providerModelInput.classList.add('hidden');
    providerBaseurlInput.value = '';
  } else if (type === 'ollama') {
    providerApikeyField.classList.add('hidden');
    providerBaseurlField.classList.remove('hidden');
    providerBaseurlInput.placeholder = 'http://localhost:11434';
    providerModelSelect.classList.add('hidden');
    providerModelInput.classList.add('hidden');
    providerApikeyInput.value = '';
    fetchOllamaModels(currentModel);
  } else {
    // custom
    providerApikeyField.classList.remove('hidden');
    providerApikeyHint.classList.remove('hidden');
    providerBaseurlField.classList.remove('hidden');
    providerBaseurlInput.placeholder = 'https://api.example.com';
    providerModelSelect.classList.add('hidden');
    providerModelInput.classList.remove('hidden');
    providerModelInput.placeholder = '例如：gpt-4o';
  }
}

providerTypeSelect.addEventListener('change', () => {
  updateProviderFormFields(providerTypeSelect.value);
  verifyProviderStatus.classList.add('hidden');
});

providerBaseurlInput.addEventListener('change', () => {
  if (providerTypeSelect.value === 'ollama') {
    fetchOllamaModels(getOllamaModel());
  }
});

function openProviderModal() {
  verifyProviderStatus.classList.add('hidden');
  providerModal.classList.remove('hidden');
}

function closeProviderModal() {
  providerModal.classList.add('hidden');
  currentEditingProviderId = null;
}

addProviderBtn.addEventListener('click', () => {
  currentEditingProviderId = null;
  providerModalTitle.textContent = '添加 Provider';
  providerNameInput.value = '';
  providerTypeSelect.value = 'deepseek';
  providerApikeyInput.value = '';
  providerBaseurlInput.value = '';
  providerModelSelect.value = 'deepseek-v4-flash';
  providerModelInput.value = '';
  updateProviderFormFields('deepseek');
  openProviderModal();
});

function editProvider(id) {
  const provider = providers.find(p => p.id === id);
  if (!provider) return;

  currentEditingProviderId = id;
  providerModalTitle.textContent = '编辑 Provider';
  providerNameInput.value = provider.name;
  providerTypeSelect.value = provider.type;
  providerApikeyInput.value = provider.apiKey || '';
  providerBaseurlInput.value = provider.baseUrl || '';
  updateProviderFormFields(provider.type, provider.model);

  if (provider.type === 'deepseek') {
    providerModelSelect.value = provider.model || 'deepseek-v4-flash';
  } else if (provider.type !== 'ollama') {
    providerModelInput.value = provider.model || '';
  }

  openProviderModal();
}

async function deleteProvider(id) {
  const blocking = shortcuts.filter(s => s.providerId === id).map(s => s.name);
  if (blocking.length > 0) {
    alert(`无法删除：以下快捷键正在使用此 Provider：\n${blocking.join('、')}`);
    return;
  }
  if (!confirm('确定要删除此 Provider 吗？')) return;

  await window.electronAPI.deleteProvider(id);
  providers = providers.filter(p => p.id !== id);
  renderProviders();
}

closeProviderModalBtn.addEventListener('click', closeProviderModal);
cancelProviderModalBtn.addEventListener('click', closeProviderModal);

providerModal.addEventListener('click', (e) => {
  if (e.target === providerModal) closeProviderModal();
});

verifyProviderBtn.addEventListener('click', async () => {
  const type = providerTypeSelect.value;
  const testProvider = {
    type,
    name: providerNameInput.value.trim() || 'test',
    apiKey: providerApikeyInput.value.trim(),
    baseUrl: providerBaseurlInput.value.trim(),
    model: type === 'deepseek' ? providerModelSelect.value : (type === 'ollama' ? getOllamaModel() : providerModelInput.value.trim())
  };

  verifyProviderBtn.disabled = true;
  verifyProviderStatus.className = 'text-sm text-text-secondary-light dark:text-text-secondary-dark';
  verifyProviderStatus.textContent = '验证中...';
  verifyProviderStatus.classList.remove('hidden');

  const result = await window.electronAPI.validateProvider(testProvider);
  verifyProviderBtn.disabled = false;

  if (result.success) {
    verifyProviderStatus.className = 'text-sm text-success';
    verifyProviderStatus.textContent = '✓ 连接成功';
  } else {
    verifyProviderStatus.className = 'text-sm text-danger';
    verifyProviderStatus.textContent = `✗ ${result.error}`;
  }
});

saveProviderBtn.addEventListener('click', async () => {
  const name = providerNameInput.value.trim();
  const type = providerTypeSelect.value;
  const apiKey = providerApikeyInput.value.trim();
  const baseUrl = providerBaseurlInput.value.trim();
  const model = type === 'deepseek' ? providerModelSelect.value : (type === 'ollama' ? getOllamaModel() : providerModelInput.value.trim());

  if (!name) { alert('请填写 Provider 名称'); return; }

  const testProvider = { type, name, apiKey, baseUrl, model };
  const validation = providerModule.validateProviderConfig(testProvider);
  if (!validation.valid) {
    alert(`配置不完整：\n${validation.errors.join('\n')}`);
    return;
  }

  const providerData = {
    id: currentEditingProviderId || Date.now().toString(),
    name,
    type,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    model
  };

  await window.electronAPI.saveProvider(providerData);

  if (currentEditingProviderId) {
    const index = providers.findIndex(p => p.id === currentEditingProviderId);
    if (index >= 0) providers[index] = providerData;
  } else {
    providers.push(providerData);
  }

  renderProviders();
  renderShortcuts();
  closeProviderModal();
});

// Shortcuts Management
function getProviderLabel(providerId) {
  const provider = providers.find(p => p.id === providerId);
  if (!provider) return '未绑定';
  return `${provider.name} (${TYPE_LABELS[provider.type] || provider.type})`;
}

function renderShortcutProviderOptions() {
  shortcutProviderSelect.innerHTML = providers.map(p =>
    `<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(TYPE_LABELS[p.type] || p.type)})</option>`
  ).join('');
}

function renderShortcuts() {
  if (shortcuts.length === 0) {
    emptyState.classList.remove('hidden');
    shortcutsTableBody.innerHTML = '';
    return;
  }

  emptyState.classList.add('hidden');

  shortcutsTableBody.innerHTML = shortcuts.map(shortcut => `
    <tr class="border-b border-border-light dark:border-border-dark last:border-b-0">
      <td class="px-6 py-4 whitespace-nowrap">
        ${formatShortcut(shortcut.shortcut)}
      </td>
      <td class="px-6 py-4 text-text-primary-light dark:text-text-primary-dark">${escapeHtml(shortcut.name)}</td>
      <td class="px-6 py-4 text-text-secondary-light dark:text-text-secondary-dark text-sm">${escapeHtml(getProviderLabel(shortcut.providerId))}</td>
      <td class="px-6 py-4 text-right">
        <div class="flex justify-end gap-4">
          <button class="edit-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-primary dark:hover:text-primary" data-id="${shortcut.id}">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="delete-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-danger dark:hover:text-danger" data-id="${shortcut.id}">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  // Add event listeners
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      editShortcut(id);
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      deleteShortcut(id);
    });
  });
}

function formatShortcut(shortcut) {
  const parts = shortcut.split('+');
  return parts.map(part => {
    let displayName = part;
    let ariaLabel = part;
    // 映射到 Mac 友好的显示名称
    if (part === 'CommandOrControl' || part === 'Command') {
      displayName = '⌘';
      ariaLabel = 'Command';
    } else if (part === 'Control') {
      displayName = '⌃';
      ariaLabel = 'Control';
    } else if (part === 'Alt' || part === 'Option') {
      displayName = '⌥';
      ariaLabel = 'Option';
    } else if (part === 'Shift') {
      displayName = '⇧';
      ariaLabel = 'Shift';
    }
    return `<kbd class="px-2 py-1.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-md" aria-label="${ariaLabel}">${displayName}</kbd>`;
  }).join(' ');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Modal Management
addShortcutBtn.addEventListener('click', () => {
  if (providers.length === 0) {
    alert('请先添加至少一个 Provider，再创建快捷键。');
    return;
  }

  currentEditingId = null;
  modalTitle.textContent = '添加新快捷键';
  promptNameInput.value = '';
  renderShortcutProviderOptions();
  shortcutProviderSelect.value = providers[0].id;
  shortcutProviderEmpty.classList.add('hidden');
  keyboardShortcutInput.value = '';
  setTemplateEditor('');
  templateError.classList.add('hidden');
  shortcutCheckToken++;
  lastAvailabilityResult = null;
  hideAvailabilityStatus();
  openModal();
});

function editShortcut(id) {
  const shortcut = shortcuts.find(s => s.id === id);
  if (!shortcut) return;

  currentEditingId = id;
  modalTitle.textContent = '编辑提示模板';
  promptNameInput.value = shortcut.name;
  renderShortcutProviderOptions();
  shortcutProviderSelect.value = shortcut.providerId || providers[0]?.id || '';
  shortcutProviderEmpty.classList.add('hidden');
  keyboardShortcutInput.value = shortcut.shortcut;
  setTemplateEditor(shortcut.template);
  templateError.classList.add('hidden');
  shortcutCheckToken++;
  lastAvailabilityResult = null;
  hideAvailabilityStatus();
  openModal();
}

async function deleteShortcut(id) {
  if (!confirm('确定要删除此快捷键吗？')) {
    return;
  }

  await window.electronAPI.deleteShortcut(id);
  shortcuts = shortcuts.filter(s => s.id !== id);
  renderShortcuts();
}

function openModal() {
  promptModal.classList.remove('hidden');
}

function closeModal() {
  promptModal.classList.add('hidden');
  currentEditingId = null;
  shortcutCheckToken++;
  lastAvailabilityResult = null;
  hideAvailabilityStatus();
}

closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);

// Close modal when clicking outside
promptModal.addEventListener('click', (e) => {
  if (e.target === promptModal) {
    closeModal();
  }
});

// Save shortcut
savePromptBtn.addEventListener('click', async () => {
  const name = promptNameInput.value.trim();
  const shortcut = keyboardShortcutInput.value.trim();
  const template = getTemplateText().trim();
  const providerId = shortcutProviderSelect.value;

  // Validation
  if (!name || !shortcut || !template) {
    alert('请填写所有字段');
    return;
  }

  // Re-check availability before saving (guard against status changes after initial check)
  showAvailabilityStatus('checking', '正在检测…');
  const checkResult = await window.electronAPI.checkShortcutAvailability(shortcut, currentEditingId);
  shortcutCheckToken++; // invalidate any pending async checks
  lastAvailabilityResult = checkResult;

  if (checkResult.status !== 'available') {
    switch (checkResult.status) {
      case 'invalid':
        showAvailabilityStatus('invalid', '无效组合：至少需要两个修饰键加一个普通键。');
        break;
      case 'internal-conflict':
        showAvailabilityStatus('internal-conflict', `✗ 与已有快捷键「${checkResult.conflictWith}」重复`);
        break;
      case 'external-conflict':
        showAvailabilityStatus('external-conflict', '✗ 可能被 macOS 或其他应用占用');
        break;
      case 'unavailable':
        showAvailabilityStatus('unavailable', '暂时无法检测，请重试');
        break;
    }
    return;
  }

  if (!providerId) {
    shortcutProviderEmpty.classList.remove('hidden');
    return;
  }

  if (!templateModule.validateTemplate(template)) {
    templateError.classList.remove('hidden');
    return;
  }

  templateError.classList.add('hidden');
  shortcutProviderEmpty.classList.add('hidden');

  // Create or update shortcut
  const shortcutData = {
    id: currentEditingId || Date.now().toString(),
    name,
    shortcut,
    template,
    providerId
  };

  const saveResult = await window.electronAPI.saveShortcut(shortcutData);

  if (!saveResult.success) {
    // Save failed — preserve all form values and keep modal open
    switch (saveResult.reason) {
      case 'invalid':
        showAvailabilityStatus('invalid', '无效组合：至少需要两个修饰键加一个普通键。');
        break;
      case 'internal-conflict':
        showAvailabilityStatus('internal-conflict', '✗ 与已有快捷键重复，请更换组合');
        break;
      case 'external-conflict':
        showAvailabilityStatus('external-conflict', '✗ 可能被 macOS 或其他应用占用，请更换组合');
        break;
      case 'unavailable':
        showAvailabilityStatus('unavailable', '暂时无法检测，请重试');
        break;
      case 'registration-failed':
        showAvailabilityStatus('external-conflict', '✗ 注册失败，该组合可能已被占用');
        break;
    }
    return;
  }

  // Update local state
  if (currentEditingId) {
    const index = shortcuts.findIndex(s => s.id === currentEditingId);
    if (index >= 0) {
      shortcuts[index] = shortcutData;
    }
  } else {
    shortcuts.push(shortcutData);
  }

  renderShortcuts();
  closeModal();
});

// Keyboard shortcut capture
let recordingShortcut = false;
keyboardShortcutInput.addEventListener('focus', () => {
  recordingShortcut = true;
  keyboardShortcutInput.placeholder = '按下按键...';
});

keyboardShortcutInput.addEventListener('blur', () => {
  recordingShortcut = false;
  keyboardShortcutInput.placeholder = '按下快捷键组合...';
});

keyboardShortcutInput.addEventListener('keydown', (e) => {
  if (!recordingShortcut) return;

  e.preventDefault();

  const parts = [];

  // 在 Mac 上支持所有修饰键的组合
  // metaKey = Command (⌘), ctrlKey = Control (^)
  if (e.ctrlKey) {
    parts.push('Control');
  }
  if (e.metaKey) {
    parts.push('Command');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }
  if (e.altKey) {
    parts.push('Alt');
  }

  // 使用 e.code 而不是 e.key 来获取物理按键
  // 这样 Shift+1 会返回 "Digit1" 而不是 "!"
  let keyCode = e.code;

  // 处理数字键：Digit0-9 -> 0-9
  if (keyCode.startsWith('Digit')) {
    const key = keyCode.replace('Digit', '');
    parts.push(key);
  }
  // 处理字母键：KeyA-Z -> A-Z
  else if (keyCode.startsWith('Key')) {
    const key = keyCode.replace('Key', '');
    parts.push(key);
  }
  // 处理 F1-F12 等功能键
  else if (keyCode.startsWith('F') && keyCode.length <= 3) {
    parts.push(keyCode);
  }
  // 忽略修饰键本身
  else if (keyCode !== 'ControlLeft' && keyCode !== 'ControlRight' &&
           keyCode !== 'MetaLeft' && keyCode !== 'MetaRight' &&
           keyCode !== 'ShiftLeft' && keyCode !== 'ShiftRight' &&
           keyCode !== 'AltLeft' && keyCode !== 'AltRight') {
    // 其他特殊键使用 e.key
    const key = e.key.toUpperCase();
    parts.push(key);
  }

  // 确保至少有修饰键+实际按键
  if (parts.length >= 2) {
    keyboardShortcutInput.value = parts.join('+');
    // Trigger availability check when a complete combo is captured
    checkShortcutAvailability(parts.join('+'), currentEditingId);
  }
});

// Initialize the app
init();
