// Global state
let currentEditingId = null;
let shortcuts = [];

// DOM elements
const apiKeyInput = document.getElementById('api-key-input');
const toggleVisibilityBtn = document.getElementById('toggle-visibility');
const saveApiKeyBtn = document.getElementById('save-api-key');
const apiStatus = document.getElementById('api-status');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

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
const promptTemplateInput = document.getElementById('prompt-template');
const templateError = document.getElementById('template-error');

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

  // Load API key
  if (config.apiKey) {
    apiKeyInput.value = config.apiKey;
    showApiStatus(true, '有效');
  }

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

// API Key Management
toggleVisibilityBtn.addEventListener('click', () => {
  const icon = toggleVisibilityBtn.querySelector('span');
  if (apiKeyInput.type === 'password') {
    apiKeyInput.type = 'text';
    icon.textContent = 'visibility';
  } else {
    apiKeyInput.type = 'password';
    icon.textContent = 'visibility_off';
  }
});

saveApiKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showApiStatus(false, '为空');
    return;
  }

  // Show loading
  saveApiKeyBtn.textContent = '验证中...';
  saveApiKeyBtn.disabled = true;

  // Validate API key
  const validation = await window.electronAPI.validateApiKey(apiKey);

  if (validation.valid) {
    await window.electronAPI.saveApiKey(apiKey);
    showApiStatus(true, '有效');
    saveApiKeyBtn.textContent = '保存密钥';
    saveApiKeyBtn.disabled = false;
  } else {
    showApiStatus(false, '无效');
    saveApiKeyBtn.textContent = '保存密钥';
    saveApiKeyBtn.disabled = false;
  }
});

function showApiStatus(isValid, text) {
  apiStatus.classList.remove('hidden');
  statusText.textContent = text;

  if (isValid) {
    statusIndicator.classList.remove('bg-danger');
    statusIndicator.classList.add('bg-success');
    statusText.classList.remove('text-danger');
    statusText.classList.add('text-success');
  } else {
    statusIndicator.classList.remove('bg-success');
    statusIndicator.classList.add('bg-danger');
    statusText.classList.remove('text-success');
    statusText.classList.add('text-danger');
  }
}

// Shortcuts Management
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
    // 映射到 Mac 友好的显示名称
    if (part === 'CommandOrControl' || part === 'Command') {
      displayName = '⌘';
    } else if (part === 'Control') {
      displayName = '⌃';
    } else if (part === 'Alt' || part === 'Option') {
      displayName = '⌥';
    } else if (part === 'Shift') {
      displayName = '⇧';
    }
    return `<kbd class="px-2 py-1.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark bg-background-light dark:bg-background-dark border border-border-light dark:border-border-dark rounded-md">${displayName}</kbd>`;
  }).join(' + ');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Modal Management
addShortcutBtn.addEventListener('click', () => {
  currentEditingId = null;
  modalTitle.textContent = '添加新快捷键';
  promptNameInput.value = '';
  keyboardShortcutInput.value = '';
  setTemplateEditor('');
  templateError.classList.add('hidden');
  openModal();
});

function editShortcut(id) {
  const shortcut = shortcuts.find(s => s.id === id);
  if (!shortcut) return;

  currentEditingId = id;
  modalTitle.textContent = '编辑提示模板';
  promptNameInput.value = shortcut.name;
  keyboardShortcutInput.value = shortcut.shortcut;
  setTemplateEditor(shortcut.template);
  templateError.classList.add('hidden');
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

  // Validation
  if (!name || !shortcut || !template) {
    alert('请填写所有字段');
    return;
  }

  if (!templateModule.validateTemplate(template)) {
    templateError.classList.remove('hidden');
    return;
  }

  templateError.classList.add('hidden');

  // Create or update shortcut
  const shortcutData = {
    id: currentEditingId || Date.now().toString(),
    name,
    shortcut,
    template
  };

  await window.electronAPI.saveShortcut(shortcutData);

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
  }
});

// Initialize the app
init();
