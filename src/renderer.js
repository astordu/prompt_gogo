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

// Initialize
async function init() {
  const config = await window.electronAPI.getConfig();

  // Load API key
  if (config.apiKey) {
    apiKeyInput.value = config.apiKey;
    showApiStatus(true, 'Valid');
  }

  // Load shortcuts
  shortcuts = config.shortcuts || [];
  renderShortcuts();
}

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
    showApiStatus(false, 'Empty');
    return;
  }

  // Show loading
  saveApiKeyBtn.textContent = 'Validating...';
  saveApiKeyBtn.disabled = true;

  // Validate API key
  const validation = await window.electronAPI.validateApiKey(apiKey);

  if (validation.valid) {
    await window.electronAPI.saveApiKey(apiKey);
    showApiStatus(true, 'Valid');
    saveApiKeyBtn.textContent = 'Save Key';
    saveApiKeyBtn.disabled = false;
  } else {
    showApiStatus(false, 'Invalid');
    saveApiKeyBtn.textContent = 'Save Key';
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
    const displayName = part === 'CommandOrControl' ? 'Cmd' : part;
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
  modalTitle.textContent = 'Add New Shortcut';
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
  modalTitle.textContent = 'Edit Prompt Template';
  promptNameInput.value = shortcut.name;
  keyboardShortcutInput.value = shortcut.shortcut;
  promptTemplateInput.value = shortcut.template;
  templateError.classList.add('hidden');
  openModal();
}

async function deleteShortcut(id) {
  if (!confirm('Are you sure you want to delete this shortcut?')) {
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
    alert('Please fill in all fields');
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
  keyboardShortcutInput.placeholder = 'Press keys...';
});

keyboardShortcutInput.addEventListener('blur', () => {
  recordingShortcut = false;
  keyboardShortcutInput.placeholder = 'Press key combination...';
});

keyboardShortcutInput.addEventListener('keydown', (e) => {
  if (!recordingShortcut) return;

  e.preventDefault();

  const parts = [];

  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  const key = e.key.toUpperCase();
  if (key !== 'CONTROL' && key !== 'META' && key !== 'SHIFT' && key !== 'ALT') {
    parts.push(key);
  }

  if (parts.length > 0 && parts[parts.length - 1] !== 'COMMANDORCONTROL' && parts[parts.length - 1] !== 'SHIFT' && parts[parts.length - 1] !== 'ALT') {
    keyboardShortcutInput.value = parts.join('+');
  }
});

// Initialize the app
init();
