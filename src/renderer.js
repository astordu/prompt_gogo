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
  promptTemplateInput.value = '';
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
  promptTemplateInput.value = shortcut.template;
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
  const template = promptTemplateInput.value.trim();

  // Validation
  if (!name || !shortcut || !template) {
    alert('请填写所有字段');
    return;
  }

  if (!template.includes('{{select_content}}')) {
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
