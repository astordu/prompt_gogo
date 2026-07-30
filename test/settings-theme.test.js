const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const settingsPath = path.join(__dirname, '..', 'src', 'settings.html');
const rendererPath = path.join(__dirname, '..', 'src', 'renderer.js');

test('settings theme uses only neutral color tokens and utilities', () => {
  const settings = fs.readFileSync(settingsPath, 'utf8');
  const renderer = fs.readFileSync(rendererPath, 'utf8');
  const chromaticUtilities = /\b(?:bg|text|border|from|to)-(?:blue|green|red|yellow|indigo|purple|pink|orange)-/;

  assert.match(settings, /<html lang="zh-CN">/);
  assert.match(settings, /"background-light": "#ffffff"/);
  assert.match(settings, /"surface-light": "#f6f8fa"/);
  assert.match(settings, /"background-dark": "#0d1117"/);
  assert.match(settings, /"card-light": "#ffffff"/);
  assert.match(settings, /"card-dark": "#161b22"/);
  assert.doesNotMatch(settings, /#135bec/i);
  assert.doesNotMatch(settings, chromaticUtilities);
  assert.doesNotMatch(renderer, chromaticUtilities);
  assert.doesNotMatch(settings, /[\u{1F300}-\u{1FAFF}]/u);
  assert.doesNotMatch(settings, /shadow-2xl/);
  assert.match(settings, /"-apple-system", "BlinkMacSystemFont", "Segoe UI"/);

  // #47 — the blocked-deletion highlight is a transparent-middle frame
  // (outline), never a solid background block (user feedback on the first
  // pass said the full-black background was too heavy).
  const flashBlock = settings.slice(
    settings.indexOf('.shortcut-row-flash'),
    settings.indexOf('</style>', settings.indexOf('.shortcut-row-flash')),
  );
  assert.match(flashBlock, /outline\s*:/, 'flash uses a frame (outline)');
  assert.doesNotMatch(flashBlock, /background-color\s*:/, 'flash has no background fill');
});

test('settings renderer applies the neutral theme to dynamic content', async (t) => {
  const settings = fs.readFileSync(settingsPath, 'utf8');
  const dom = new JSDOM(settings, { url: 'http://localhost/settings.html' });
  const page = dom.window.document;
  const calls = { savedProviders: [] };
  const provider = {
    id: 'provider-1',
    name: 'Local Model',
    type: 'ollama',
    baseUrl: 'http://localhost:11434',
    model: 'qwen3',
  };
  const shortcut = {
    id: 'shortcut-1',
    name: 'Summarize',
    shortcut: 'Control+Alt+9',
    template: 'Summarize @select_content',
    providerId: provider.id,
    inactive: true,
  };
  const injectedGlobalKeys = [
    'window',
    'document',
    'Event',
    'KeyboardEvent',
    'Node',
    'HTMLElement',
    'getComputedStyle',
    'confirm',
    'alert',
    'providerModule',
    'templateModule',
    'shortcutDraftModule',
  ];
  const originalGlobals = new Map(
    injectedGlobalKeys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]),
  );

  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle,
    confirm: () => true,
    alert: () => {},
    providerModule: require('../src/provider'),
    templateModule: require('../src/template'),
    shortcutDraftModule: require('../src/shortcut-draft'),
  });
  Object.assign(dom.window, {
    confirm: global.confirm,
    alert: global.alert,
    electronAPI: {
      getConfig: async () => ({ providers: [provider], shortcuts: [shortcut] }),
      saveProvider: async (value) => calls.savedProviders.push(value),
      deleteProvider: async () => {},
      validateProvider: async () => ({ success: true }),
      saveShortcut: async () => ({ success: true }),
      deleteShortcut: async () => {},
      checkShortcutAvailability: async () => ({ status: 'available' }),
      recommendShortcut: async () => null,
      recheckShortcut: async () => ({ recovered: true }),
    },
  });

  const rendererPath = require.resolve('../src/renderer');
  t.after(() => {
    delete require.cache[rendererPath];
    dom.window.close();
    for (const key of injectedGlobalKeys) {
      const descriptor = originalGlobals.get(key);
      if (descriptor) {
        Object.defineProperty(global, key, descriptor);
      } else {
        delete global[key];
      }
    }
  });

  delete require.cache[rendererPath];
  require(rendererPath);
  await new Promise(resolve => setImmediate(resolve));

  const providerBadge = page.querySelector('#providers-table-body span');
  const inactiveBadge = page.querySelector('#shortcuts-table-body td:nth-child(2) span');
  assert.match(providerBadge.className, /border-border-light/);
  assert.match(providerBadge.className, /bg-surface-light/);
  assert.match(inactiveBadge.className, /bg-surface-light/);
  assert.doesNotMatch(`${providerBadge.className} ${inactiveBadge.className}`, /yellow|blue/);

  // About & Help section (merged): collapsed by default, expands on click
  assert.equal(page.getElementById('mac-permission-toggle'), null);
  assert.equal(page.getElementById('about-content').classList.contains('hidden'), true);
  page.getElementById('about-toggle').click();
  assert.equal(page.getElementById('about-content').classList.contains('hidden'), false);

  // Mac permission guide is nested inside the merged section
  const headings = [...page.querySelectorAll('#about-content h3')].map(h => h.textContent.trim());
  assert.ok(headings.some(t => t.includes('Mac 权限设置指南')));

  page.getElementById('add-provider-btn').click();
  assert.equal(page.getElementById('provider-modal').classList.contains('hidden'), false);

  page.getElementById('provider-name').value = 'Custom Model';
  page.getElementById('provider-type').value = 'custom';
  page.getElementById('provider-type').dispatchEvent(new Event('change'));
  page.getElementById('provider-baseurl').value = 'https://example.com';
  page.getElementById('provider-model-input').value = 'example-model';
  page.getElementById('save-provider-btn').click();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(calls.savedProviders.length, 1);
  assert.equal(calls.savedProviders[0].name, 'Custom Model');
  assert.equal(page.getElementById('provider-modal').classList.contains('hidden'), true);

  // Prompt template editor enlarge mode (#46): toggle on/off, icon swaps, no leak on reopen
  page.getElementById('add-shortcut-btn').click();
  const promptModalBox = page.getElementById('prompt-modal-box');
  const expandIcon = page.getElementById('expand-modal-icon');
  assert.equal(promptModalBox.classList.contains('expanded'), false);
  assert.equal(expandIcon.textContent, 'fullscreen');
  page.getElementById('expand-modal-btn').click();
  assert.equal(promptModalBox.classList.contains('expanded'), true);
  assert.equal(expandIcon.textContent, 'fullscreen_exit');
  page.getElementById('expand-modal-btn').click();
  assert.equal(promptModalBox.classList.contains('expanded'), false);
  // Enlarge state must reset on close and not leak into the next session
  page.getElementById('expand-modal-btn').click();
  assert.equal(promptModalBox.classList.contains('expanded'), true);
  page.getElementById('cancel-modal').click();
  assert.equal(promptModalBox.classList.contains('expanded'), false);
  page.getElementById('add-shortcut-btn').click();
  assert.equal(promptModalBox.classList.contains('expanded'), false);
});

// #47 — when a Provider deletion is blocked by dependent Shortcuts, the
// dependent rows must be scrolled to and flashed so the user knows which
// ones to resolve. Blocking must never delete the Provider.
test('blocking Provider deletion flashes the dependent shortcut rows (#47)', async (t) => {
  const settings = fs.readFileSync(settingsPath, 'utf8');
  const dom = new JSDOM(settings, { url: 'http://localhost/settings.html' });
  const page = dom.window.document;

  const providerA = { id: 'provider-A', name: '被依赖', type: 'deepseek', model: 'deepseek-v4-flash' };
  const providerB = { id: 'provider-B', name: '另一个', type: 'deepseek', model: 'deepseek-v4-flash' };
  const dependentOne = {
    id: 'sc-1', name: '依赖一', shortcut: 'Control+Alt+1',
    template: 'a @select_content', providerId: providerA.id,
  };
  const dependentTwo = {
    id: 'sc-2', name: '依赖二', shortcut: 'Control+Alt+2',
    template: 'b @select_content', providerId: providerA.id,
  };
  const independent = {
    id: 'sc-3', name: '独立', shortcut: 'Control+Alt+3',
    template: 'c @select_content', providerId: providerB.id,
  };

  const calls = { deletedProviders: [] };
  const injectedGlobalKeys = [
    'window', 'document', 'Event', 'KeyboardEvent', 'Node', 'HTMLElement',
    'getComputedStyle', 'confirm', 'alert', 'providerModule', 'templateModule', 'shortcutDraftModule',
  ];
  const originalGlobals = new Map(
    injectedGlobalKeys.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]),
  );

  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle,
    confirm: () => true,
    alert: () => {},
    providerModule: require('../src/provider'),
    templateModule: require('../src/template'),
    shortcutDraftModule: require('../src/shortcut-draft'),
  });
  Object.assign(dom.window, {
    confirm: global.confirm,
    alert: global.alert,
    electronAPI: {
      getConfig: async () => ({ providers: [providerA, providerB], shortcuts: [dependentOne, dependentTwo, independent] }),
      saveProvider: async () => {},
      deleteProvider: async (id) => calls.deletedProviders.push(id),
      validateProvider: async () => ({ success: true }),
      saveShortcut: async () => ({ success: true }),
      deleteShortcut: async () => {},
      checkShortcutAvailability: async () => ({ status: 'available' }),
      recommendShortcut: async () => null,
      recheckShortcut: async () => ({ recovered: true }),
    },
  });

  t.after(() => {
    delete require.cache[rendererPath];
    dom.window.close();
    for (const key of injectedGlobalKeys) {
      const descriptor = originalGlobals.get(key);
      if (descriptor) {
        Object.defineProperty(global, key, descriptor);
      } else {
        delete global[key];
      }
    }
  });

  delete require.cache[rendererPath];
  require(rendererPath);
  await new Promise(resolve => setImmediate(resolve));

  // Trigger deletion on the Provider that two Shortcuts depend on.
  page.querySelector('.provider-delete-btn[data-id="provider-A"]').click();
  await new Promise(resolve => setImmediate(resolve));

  const rowOne = page.querySelector('tr[data-shortcut-id="sc-1"]');
  const rowTwo = page.querySelector('tr[data-shortcut-id="sc-2"]');
  const rowIndependent = page.querySelector('tr[data-shortcut-id="sc-3"]');

  // Both dependent rows flash at once; the unrelated row does not.
  assert.ok(rowOne.classList.contains('shortcut-row-flash'), 'first dependent row is highlighted');
  assert.ok(rowTwo.classList.contains('shortcut-row-flash'), 'second dependent row is highlighted');
  assert.equal(rowIndependent.classList.contains('shortcut-row-flash'), false, 'unrelated row is untouched');

  // Core behavior preserved: the Provider is not deleted while blocked.
  assert.equal(calls.deletedProviders.length, 0, 'Provider is not deleted while blocked');
  assert.ok(page.querySelector('.provider-delete-btn[data-id="provider-A"]'), 'Provider row remains');
});
