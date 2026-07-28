// Global state
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
const shortcutRecommendation = document.getElementById('shortcut-recommendation');
const adoptRecommendationBtn = document.getElementById('adopt-recommendation-btn');
const recommendationText = document.getElementById('recommendation-text');
const noRecommendation = document.getElementById('no-recommendation');
const promptTemplateInput = document.getElementById('prompt-template');
const templateError = document.getElementById('template-error');
const shortcutProviderSelect = document.getElementById('shortcut-provider');
const shortcutProviderEmpty = document.getElementById('shortcut-provider-empty');

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
      return `<kbd class="px-2 py-1.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-md" aria-label="${mod.label}">${mod.symbol}</kbd>`;
    }
    return `<kbd class="px-2 py-1.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-md" aria-label="${part}">${part}</kbd>`;
  }).join(' ');
}

// ---------------------------------------------------------------------------
// Shortcut Draft — page adapter over the workflow module
// ---------------------------------------------------------------------------

/**
 * Production adapter that bridges ShortcutDraft to Electron IPC.
 * Each method delegates to the existing main-process ShortcutService.
 */
const draftAdapter = {
  checkAvailability(accelerator, excludeId) {
    return window.electronAPI.checkShortcutAvailability(accelerator, excludeId);
  },
  recommendShortcut(accelerator, excludeId, shortcutName) {
    return window.electronAPI.recommendShortcut(accelerator, excludeId, shortcutName);
  },
  saveShortcut(shortcut) {
    return window.electronAPI.saveShortcut(shortcut);
  },
  getConfig() {
    return window.electronAPI.getConfig();
  },
};

const draft = new shortcutDraftModule.ShortcutDraft(draftAdapter);

/**
 * Map a semantic snapshot from the workflow module to DOM.
 * This is the only place that translates status → Chinese copy / styles.
 */
function renderDraftSnapshot(snapshot) {
  // Update input fields from the authoritative draft state
  if (promptNameInput.value !== snapshot.name) {
    promptNameInput.value = snapshot.name;
  }
  if (keyboardShortcutInput.value !== snapshot.accelerator) {
    keyboardShortcutInput.value = snapshot.accelerator;
  }
  if (shortcutProviderSelect.value !== (snapshot.providerId || '')) {
    shortcutProviderSelect.value = snapshot.providerId || '';
  }

  // Template is managed by the chip editor; sync only on session open
  // (handled separately in openAdd/openEdit).

  // --- Availability status ---
  const status = snapshot.status;
  const conflictWith = snapshot.conflictWith;

  switch (status) {
    case 'idle':
      hideAvailabilityStatus();
      hideRecommendation();
      templateError.classList.add('hidden');
      shortcutProviderEmpty.classList.add('hidden');
      break;
    case 'checking':
      showAvailabilityStatus('checking', '正在检测…');
      hideRecommendation();
      break;
    case 'invalid':
      showAvailabilityStatus('invalid', '无效组合：至少需要两个修饰键（Control / Option / Shift / Command）加一个普通键。');
      hideRecommendation();
      break;
    case 'available':
      showAvailabilityStatus('available', '✓ 当前可用');
      hideRecommendation();
      break;
    case 'internal-conflict':
      showAvailabilityStatus('internal-conflict', `✗ 与已有快捷键「${conflictWith || ''}」重复`);
      break;
    case 'external-conflict':
      showAvailabilityStatus('external-conflict', '✗ 可能被 macOS 或其他应用占用');
      break;
    case 'unavailable':
      showAvailabilityStatus('unavailable', '暂时无法检测，请点击重新检测');
      hideRecommendation();
      break;
    case 'missing-name':
      hideAvailabilityStatus();
      hideRecommendation();
      templateError.classList.add('hidden');
      shortcutProviderEmpty.classList.add('hidden');
      promptNameInput.focus();
      break;
    case 'missing-shortcut':
      hideAvailabilityStatus();
      hideRecommendation();
      templateError.classList.add('hidden');
      shortcutProviderEmpty.classList.add('hidden');
      keyboardShortcutInput.focus();
      break;
    case 'invalid-template':
      hideAvailabilityStatus();
      hideRecommendation();
      templateError.classList.remove('hidden');
      shortcutProviderEmpty.classList.add('hidden');
      break;
    case 'missing-provider':
      hideAvailabilityStatus();
      hideRecommendation();
      templateError.classList.add('hidden');
      shortcutProviderEmpty.classList.remove('hidden');
      break;
    case 'saving':
      showAvailabilityStatus('checking', '正在保存…');
      hideRecommendation();
      savePromptBtn.disabled = true;
      break;
    case 'save-failure':
      savePromptBtn.disabled = false;
      showAvailabilityStatus('external-conflict', '✗ 注册失败，该组合可能已被占用');
      break;
    case 'saved':
      savePromptBtn.disabled = false;
      // The authoritative snapshot is used to re-render the list
      if (snapshot.savedSnapshot) {
        shortcuts = snapshot.savedSnapshot.shortcuts || [];
        providers = snapshot.savedSnapshot.providers || providers;
        renderShortcuts();
      }
      closeModal();
      return;
  }

  // --- Recommendation ---
  if (status !== 'saving' && status !== 'saved') {
    savePromptBtn.disabled = false;
  }

  if (snapshot.recommendation) {
    const display = formatAcceleratorForDisplay(snapshot.recommendation);
    recommendationText.innerHTML = '推荐使用 ' + display;
    shortcutRecommendation.classList.remove('hidden');
    noRecommendation.classList.add('hidden');
  } else if (status === 'internal-conflict' || status === 'external-conflict') {
    // Recommendation may still be loading; hide the suggestion only if
    // the module has cleared it (null) after the conflict was set.
    // We check via the snapshot — if recommendation is null after conflict
    // settled, show "no recommendation" only if the status is a conflict.
    // But the module emits immediately on conflict with null recommendation,
    // then emits again when the recommendation arrives. To avoid flicker,
    // we only show "no recommendation" if we're confident the async rec
    // has completed. Since the module doesn't expose a "rec-loading" flag,
    // we leave the recommendation area hidden during conflict until a rec
    // arrives or the user moves on.
    hideRecommendation();
  } else {
    hideRecommendation();
  }
}

draft.subscribe(renderDraftSnapshot);

// --- Availability status helpers (DOM only) ---

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

function hideRecommendation() {
  shortcutRecommendation.classList.add('hidden');
  noRecommendation.classList.add('hidden');
  recommendationText.textContent = '';
}

// --- Recommendation adoption ---

adoptRecommendationBtn.addEventListener('click', () => {
  draft.adoptRecommendation();
});

// --- Modal field events → workflow module ---

promptNameInput.addEventListener('input', () => {
  draft.setName(promptNameInput.value);
});

shortcutProviderSelect.addEventListener('change', () => {
  draft.setProviderId(shortcutProviderSelect.value);
});

const macPermissionToggle = document.getElementById('mac-permission-toggle');
const macPermissionContent = document.getElementById('mac-permission-content');
const macPermissionIcon = document.getElementById('mac-permission-icon');

const aboutToggle = document.getElementById('about-toggle');
const aboutContent = document.getElementById('about-content');
const aboutIcon = document.getElementById('about-icon');

// --- Template chip editor (contenteditable + atomic chips) ---

function createChip(varName) {
  const chip = document.createElement('span');
  // @ts-expect-error Existing browser assignment is coerced to the string "false".
  chip.contentEditable = false;
  chip.className = 'template-chip';
  chip.dataset.variable = varName;
  chip.textContent = '@' + varName;
  return chip;
}

function restoreVariableChipBeforeCaret() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;

  const range = sel.getRangeAt(0);

  let previousNode = null;
  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
    previousNode = range.startContainer.previousSibling;
  } else if (range.startContainer.nodeType === Node.ELEMENT_NODE && range.startOffset > 0) {
    previousNode = range.startContainer.childNodes[range.startOffset - 1];
  }

  if (
    !previousNode ||
    previousNode.nodeType !== Node.ELEMENT_NODE ||
    !previousNode.dataset ||
    previousNode.dataset.variable === undefined
  ) {
    return false;
  }

  const variableText = document.createTextNode(
    '@' + previousNode.dataset.variable
  );
  previousNode.parentNode.replaceChild(variableText, previousNode);

  if (range.collapsed) {
    const afterVariableText = document.createRange();
    afterVariableText.setStart(variableText, variableText.textContent.length);
    afterVariableText.collapse(true);
    sel.removeAllRanges();
    sel.addRange(afterVariableText);
  }
  hideCompletionMenu();
  return true;
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

function isTemplateBlockElement(element) {
  return element.tagName === 'DIV' || element.tagName === 'P';
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
        const isBlock = isTemplateBlockElement(child);
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

function getFirstTemplateCharacter(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.charAt(0);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  if (node.dataset && node.dataset.variable !== undefined) return '@';
  if (node.tagName === 'BR' || isTemplateBlockElement(node)) return '\n';

  for (const child of node.childNodes) {
    const character = getFirstTemplateCharacter(child);
    if (character) return character;
  }
  return '';
}

function getNextTemplateCharacter(node, offset) {
  if (node.nodeType === Node.TEXT_NODE) {
    const characterInNode = node.textContent.charAt(offset);
    if (characterInNode) return characterInNode;
  }

  let current = node;
  while (current && current !== promptTemplateInput) {
    let sibling = current.nextSibling;
    while (sibling) {
      const character = getFirstTemplateCharacter(sibling);
      if (character) return character;
      sibling = sibling.nextSibling;
    }
    current = current.parentNode;
  }
  return '';
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
  if (/^[a-zA-Z0-9]/.test(text)) {
    restoreVariableChipBeforeCaret();
  }
  const nodes = templateModule.parseTemplate(text);
  insertNodesAtCaret(nodes);
  // Notify the workflow module of the updated template text
  draft.setTemplate(getTemplateText());
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
    // A chip's label is display-only. Re-processing it would wrap the
    // existing chip in another chip on every subsequent input event.
    if (node.parentElement && node.parentElement.closest('.template-chip')) {
      continue;
    }
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
  // Notify the workflow module of the updated template text
  draft.setTemplate(getTemplateText());
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
      ? 'bg-surface-light dark:bg-surface-dark'
      : 'hover:bg-surface-light dark:hover:bg-surface-dark';
    return `<div class="completion-item ${bgClass}" data-var="${v.name}" data-index="${i}">
      <span class="completion-item-name text-text-primary-light dark:text-text-primary-dark">${v.name}</span>
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

  // Keep the caret in an editable text node after the atomic chip. A caret
  // placed directly on the contenteditable=false boundary can make Chromium
  // draw a second selection outline when the user types the next character.
  let textAfterChip = chip.nextSibling;
  if (!textAfterChip || textAfterChip.nodeType !== Node.TEXT_NODE) {
    textAfterChip = document.createTextNode('');
    chip.parentNode.insertBefore(textAfterChip, chip.nextSibling);
  }

  const after = document.createRange();
  after.setStart(textAfterChip, 0);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);

  hideCompletionMenu();
  // Notify the workflow module of the updated template text
  draft.setTemplate(getTemplateText());
}

function handleCompletionInput() {
  const info = getAtQueryFromCaret();
  if (!info) {
    hideCompletionMenu();
    return;
  }

  const nextCharacter = getNextTemplateCharacter(
    info.node,
    window.getSelection().getRangeAt(0).startOffset
  );

  // A complete variable at the caret is already unambiguous. Commit it now
  // instead of waiting for a following space/punctuation to close the menu;
  // the delimiter must not be what changes the chip's visual state.
  const exactMatch = templateModule.VARIABLES.find(
    variable => variable.name === info.query
  );
  if (exactMatch && !/[a-zA-Z0-9]/.test(nextCharacter)) {
    confirmSelection(exactMatch.name);
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

promptTemplateInput.addEventListener('beforeinput', (e) => {
  // If an ASCII letter/digit immediately extends an already-committed chip,
  // turn the chip back into text before the browser inserts that character.
  // This preserves the parser's word-boundary rule: @select_contentX is text,
  // while @select_content followed by whitespace/punctuation stays a chip.
  if (typeof e.data !== 'string' || !/^[a-zA-Z0-9]/.test(e.data)) return;
  restoreVariableChipBeforeCaret();
});

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

// About / Contact Toggle
aboutToggle.addEventListener('click', () => {
  const isHidden = aboutContent.classList.contains('hidden');

  if (isHidden) {
    aboutContent.classList.remove('hidden');
    aboutIcon.style.transform = 'rotate(180deg)';
  } else {
    aboutContent.classList.add('hidden');
    aboutIcon.style.transform = 'rotate(0deg)';
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
        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-primary-light dark:text-text-primary-dark">${escapeHtml(TYPE_LABELS[p.type] || p.type)}</span>
      </td>
      <td class="px-6 py-4 text-text-secondary-light dark:text-text-secondary-dark font-mono text-sm">${escapeHtml(p.model || '')}</td>
      <td class="px-6 py-4 text-right">
        <div class="flex justify-end gap-4">
          <button class="provider-edit-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-primary dark:hover:text-text-primary-dark" data-id="${p.id}">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="provider-delete-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-danger dark:hover:text-text-primary-dark" data-id="${p.id}">
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

  shortcutsTableBody.innerHTML = shortcuts.map(shortcut => {
    const isInactive = shortcut.inactive === true;
    const inactiveBadge = isInactive
      ? `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-text-primary-light dark:text-text-primary-dark">冲突，未生效</span>`
      : '';
    const recheckBtn = isInactive
      ? `<button class="recheck-btn inline-flex items-center gap-1 text-sm text-primary hover:underline cursor-pointer" data-id="${shortcut.id}">
           <span class="material-symbols-outlined text-base">refresh</span>
           <span>重新检测</span>
         </button>`
      : '';

    return `
    <tr class="border-b border-border-light dark:border-border-dark last:border-b-0">
      <td class="px-6 py-4 whitespace-nowrap">
        ${formatShortcut(shortcut.shortcut)}
      </td>
      <td class="px-6 py-4 text-text-primary-light dark:text-text-primary-dark">
        ${escapeHtml(shortcut.name)}${inactiveBadge}
      </td>
      <td class="px-6 py-4 text-text-secondary-light dark:text-text-secondary-dark text-sm">${escapeHtml(getProviderLabel(shortcut.providerId))}</td>
      <td class="px-6 py-4 text-right">
        <div class="flex justify-end items-center gap-4">
          ${recheckBtn}
          <button class="edit-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-primary dark:hover:text-text-primary-dark" data-id="${shortcut.id}">
            <span class="material-symbols-outlined">edit</span>
          </button>
          <button class="delete-btn text-text-secondary-light dark:text-text-secondary-dark hover:text-danger dark:hover:text-text-primary-dark" data-id="${shortcut.id}">
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      </td>
    </tr>
  `;
  }).join('');

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

  document.querySelectorAll('.recheck-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      recheckShortcut(id);
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
    return `<kbd class="px-2 py-1.5 text-xs font-semibold text-text-secondary-light dark:text-text-secondary-dark bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark rounded-md" aria-label="${ariaLabel}">${displayName}</kbd>`;
  }).join(' ');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Shortcut Draft session lifecycle (modal open/close) ---

addShortcutBtn.addEventListener('click', () => {
  if (providers.length === 0) {
    alert('请先添加至少一个 Provider，再创建快捷键。');
    return;
  }

  modalTitle.textContent = '添加新快捷键';
  renderShortcutProviderOptions();
  shortcutProviderEmpty.classList.add('hidden');
  templateError.classList.add('hidden');
  savePromptBtn.disabled = false;

  // Start a blank add session in the workflow module
  draft.startAdd();

  // Initialize template editor to empty
  setTemplateEditor('');

  // Set default provider
  draft.setProviderId(providers[0].id);

  openModal();
});

function editShortcut(id) {
  const shortcut = shortcuts.find(s => s.id === id);
  if (!shortcut) return;

  modalTitle.textContent = '编辑提示模板';
  renderShortcutProviderOptions();
  shortcutProviderEmpty.classList.add('hidden');
  templateError.classList.add('hidden');
  savePromptBtn.disabled = false;

  // Start an edit session initialized from the existing shortcut
  draft.startEdit({
    id: shortcut.id,
    name: shortcut.name,
    shortcut: shortcut.shortcut,
    template: shortcut.template,
    providerId: shortcut.providerId,
  });

  // Initialize template editor with the shortcut's template
  setTemplateEditor(shortcut.template);

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

async function recheckShortcut(id) {
  const result = await window.electronAPI.recheckShortcut(id);

  if (result.recovered) {
    // Update local state — the shortcut is now active
    shortcuts = shortcuts.map(s =>
      s.id === id ? { ...s, inactive: false } : s
    );
    renderShortcuts();
  } else {
    // Still inactive — show the reason
    const sc = shortcuts.find(s => s.id === id);
    const name = sc ? sc.name : '快捷键';
    if (result.reason === 'not-found') {
      alert(`「${name}」未找到。`);
    } else {
      alert(`「${name}」仍然无法注册，可能被其他应用占用。\n请进入编辑更换快捷键组合。`);
    }
  }
}

function openModal() {
  promptModal.classList.remove('hidden');
}

function closeModal() {
  promptModal.classList.add('hidden');
  // Close the draft session — all in-flight results become stale
  draft.close();
}

closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);

// Close modal when clicking outside
promptModal.addEventListener('click', (e) => {
  if (e.target === promptModal) {
    closeModal();
  }
});

// Save shortcut — delegates entirely to the workflow module's save path
savePromptBtn.addEventListener('click', () => {
  draft.save();
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
    const accelerator = parts.join('+');
    // Route through the workflow module — it handles validation,
    // availability check, and stale-result rejection
    draft.setAccelerator(accelerator);
  }
});

// Initialize the app
init();
