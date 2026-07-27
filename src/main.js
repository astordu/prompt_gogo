const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');
const { buildRequestConfig, validateProviderConfig, migrateToProviders } = require('./provider');
const { ShortcutService, createElectronRegistrar, createElectronStore } = require('./shortcut-service');
const { RunCoordinator } = require('./run/run-coordinator');
const { createOutputTarget } = require('./run/output-target');
const { createRunIndicatorSink } = require('./run/run-indicator');
const { createTextReader } = require('./run/text-reader');
const { sseTextStream } = require('./run/sse-stream');
const { RunExecutor } = require('./run/run-executor');

// Initialize config store
const store = new Store({
  defaults: {
    providers: [],
    shortcuts: [
      {
        id: '1',
        name: '整理文本内容',
        shortcut: 'Control+Alt+9',
        template: '将以下内容整理成语句通顺，有条理的内容，可以改变语言表达方式，增加适当的标点符号：\n\n@select_content\n\n注意：\n1.输出纯文本文本格式，不要使用markdown格式\n2.不要有回车，要是一段文本\n3.不要输出解释内容，直接输出整理后的内容。'
      },
      {
        id: '2',
        name: '翻译成英文',
        shortcut: 'Control+Alt+0',
        template: '请将下面这段中文文本翻译成英文。只输出翻译结果，不要有任何解释、说明或额外内容：\n\n@select_content\n\n要求：直接输出英文翻译，一段完整的句子，不要换行，不要markdown格式。'
      }
    ]
  }
});

let mainWindow = null;
let tray = null;

// Shortcut management service (created in app.whenReady to ensure showNotification is available)
let shortcutService = null;

// Run executor (created in app.whenReady alongside shortcutService)
let runExecutor = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Prompt Go - 设置'
  });

  mainWindow.loadFile(path.join(__dirname, 'settings.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // 创建托盘图标（需要添加图标文件）
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    { label: '设置', click: () => { showWindow(); } },
    { label: '退出', click: () => { app.quit(); } }
  ]);

  tray.setToolTip('Prompt Go');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => { showWindow(); });
}

function showWindow() {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function migrateTemplates() {
  const shortcuts = store.get('shortcuts');
  const migrated = shortcuts.map(s => ({
    ...s,
    template: s.template.replace(/\{\{select_content\}\}/g, '@select_content')
  }));
  const changed = migrated.some((s, i) => s.template !== shortcuts[i].template);
  if (changed) {
    store.set('shortcuts', migrated);
    console.log('✅ 模板迁移完成：{{select_content}} → @select_content');
  }
}

function findProvider(providerId) {
  if (!providerId) return null;
  const providers = store.get('providers') || [];
  return providers.find(p => p.id === providerId) || null;
}

function migrateProviders() {
  const storeData = store.store;

  const hasProviders = Array.isArray(storeData.providers);
  const allShortcutsHaveIds = Array.isArray(storeData.shortcuts) &&
    storeData.shortcuts.length > 0 &&
    storeData.shortcuts.every(s => s.providerId);

  if (hasProviders && allShortcutsHaveIds) return;

  const providerId = Date.now().toString();
  const result = migrateToProviders(storeData, providerId);

  store.set('providers', result.providers);
  store.set('shortcuts', result.shortcuts);
  store.delete('apiKey');

  console.log('✅ Provider 迁移完成');
}

function registerShortcuts() {
  console.log('\n========================================');
  console.log('📌 开始注册快捷键...');
  console.log('========================================');

  const beforeCount = shortcutService ? shortcutService.getRegisteredAccelerators().length : 0;

  shortcutService.registerAllAtStartup();

  const afterCount = shortcutService.getRegisteredAccelerators().length;
  const shortcuts = shortcutService.getShortcuts();
  const failedCount = shortcuts.length - afterCount;

  console.log('========================================');
  console.log(`✅ 快捷键注册完成: ${afterCount} 个成功, ${failedCount} 个失败`);
  console.log('========================================\n');

  // Register a test shortcut to verify the system is working
  console.log('🧪 注册测试快捷键: Command+Shift+F12');
  const testSuccess = globalShortcut.register('Command+Shift+F12', () => {
    console.log('\n🎉🎉🎉 测试快捷键工作正常！🎉🎉🎉\n');
    showNotification('测试成功', '快捷键系统工作正常！如果你看到这个，说明权限OK');
  });

  if (testSuccess) {
    console.log('✅ 测试快捷键注册成功');
    console.log('💡 请按 Cmd+Shift+F12 测试快捷键系统是否工作\n');
  } else {
    console.log('❌ 测试快捷键注册失败\n');
  }

  console.log('💡 现在可以在任意应用中选中文字并按快捷键测试！');
  console.log('💡 日志将显示在下方...\n');
}

function showNotification(title, body) {
  const { Notification } = require('electron');

  if (Notification.isSupported()) {
    new Notification({
      title,
      body
    }).show();
  }
}

/**
 * Production model-request adapter: sends a streaming chat completion
 * request via axios and returns an async iterable of content chunks
 * parsed from the SSE response.
 */
function createModelRequestAdapter() {
  return async function sendModelRequest(requestConfig, prompt, signal) {
    const response = await axios.post(requestConfig.url, {
      ...requestConfig.body,
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: true,
      temperature: 0.7
    }, {
      headers: requestConfig.headers,
      responseType: 'stream',
      timeout: 60000,
      signal: signal || undefined
    });

    return sseTextStream(response.data);
  };
}

// IPC Handlers
ipcMain.handle('get-config', () => {
  const shortcuts = shortcutService ? shortcutService.getShortcuts() : store.get('shortcuts');
  // Annotate each shortcut with its active/inactive session status
  const annotated = (shortcuts || []).map(sc => ({
    ...sc,
    inactive: shortcutService ? shortcutService.isShortcutInactive(sc.id) : false,
  }));
  return {
    providers: store.get('providers'),
    shortcuts: annotated
  };
});

ipcMain.handle('get-shortcuts', () => {
  return shortcutService ? shortcutService.getShortcuts() : store.get('shortcuts');
});

ipcMain.handle('save-shortcut', (event, shortcut) => {
  return shortcutService.saveShortcut(shortcut);
});

ipcMain.handle('check-shortcut-availability', (event, accelerator, excludeId) => {
  return shortcutService.checkAvailability(accelerator, excludeId);
});

ipcMain.handle('recommend-shortcut', (event, accelerator, excludeId, shortcutName) => {
  return shortcutService.recommendShortcut(accelerator, excludeId, shortcutName);
});

ipcMain.handle('delete-shortcut', (event, id) => {
  return shortcutService.deleteShortcut(id);
});

ipcMain.handle('recheck-shortcut', (event, id) => {
  return shortcutService.recheckShortcut(id);
});

ipcMain.handle('save-provider', (event, provider) => {
  const providers = store.get('providers') || [];
  const index = providers.findIndex(p => p.id === provider.id);
  if (index >= 0) {
    providers[index] = provider;
  } else {
    providers.push(provider);
  }
  store.set('providers', providers);
  return { success: true };
});

ipcMain.handle('delete-provider', (event, id) => {
  const shortcuts = store.get('shortcuts') || [];
  const blocking = shortcuts.filter(s => s.providerId === id);
  if (blocking.length > 0) {
    return { success: false, blockingShortcuts: blocking.map(s => s.name) };
  }
  const providers = (store.get('providers') || []).filter(p => p.id !== id);
  store.set('providers', providers);
  return { success: true };
});

ipcMain.handle('validate-provider', async (event, provider) => {
  const validation = validateProviderConfig(provider);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join(', ') };
  }

  try {
    if (provider.type === 'ollama') {
      const base = (provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      const response = await axios.get(`${base}/api/tags`, { timeout: 5000 });
      return { success: true, models: (response.data.models || []).map(m => m.name) };
    } else {
      const requestConfig = buildRequestConfig(provider);
      await axios.post(requestConfig.url, {
        ...requestConfig.body,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
        stream: false
      }, {
        headers: requestConfig.headers,
        timeout: 10000
      });
      return { success: true };
    }
  } catch (error) {
    const status = error.response?.status;
    if (status === 401) return { success: false, error: 'API Key 无效' };
    if (status === 404) return { success: false, error: '接口地址不存在，请检查 Base URL' };
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
      return { success: false, error: '无法连接服务，请检查服务是否运行' };
    }
    return { success: true }; // 其他状态码（如 400/422）说明服务可达，Key 有效
  }
});

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  // Uncomment when you have a tray icon
  // createTray();

  // Check accessibility permissions on macOS
  if (process.platform === 'darwin') {
    const { systemPreferences } = require('electron');
    const hasAccessibility = systemPreferences.isTrustedAccessibilityClient(false);

    if (!hasAccessibility) {
      console.warn('⚠️ 警告: 应用没有辅助功能权限');
      console.log('💡 请前往: 系统偏好设置 > 安全性与隐私 > 隐私 > 辅助功能');
      console.log('💡 将 Electron 或 Prompt Go 添加到允许列表中\n');

      setTimeout(() => {
        showNotification(
          '需要辅助功能权限',
          '请在系统偏好设置 > 隐私 > 辅助功能中授予权限，否则快捷键可能无法正常工作'
        );
      }, 2000);
    } else {
      console.log('✅ 辅助功能权限已授予\n');
    }
  }

  migrateTemplates();
  migrateProviders();

  // Create the text reader for macOS selected-text access
  const textReader = createTextReader({ clipboard });

  // Create the run coordinator with globalShortcut as the cancel registrar
  const runCoordinator = new RunCoordinator({
    cancelRegistrar: {
      register(accelerator, callback) {
        return globalShortcut.register(accelerator, callback);
      },
      unregister(accelerator) {
        globalShortcut.unregister(accelerator);
      },
    },
    onNotify: (title, body) => showNotification(title, body),
    readSelectedText: () => textReader.readSelectedText(),
    outputTarget: createOutputTarget(),
    runIndicator: createRunIndicatorSink({ clipboard }),
  });

  // Create the run executor with all system dependencies injected
  runExecutor = new RunExecutor({
    coordinator: runCoordinator,
    readSelectedText: () => textReader.readSelectedText(),
    findProvider,
    sendModelRequest: createModelRequestAdapter(),
    onNotify: (title, body) => showNotification(title, body),
    onShowWindow: () => showWindow(),
  });

  // Create the shortcut management service with injectable dependencies
  shortcutService = new ShortcutService({
    registrar: createElectronRegistrar(globalShortcut),
    store: createElectronStore(store),
    onTrigger: (shortcutConfig) => {
      runExecutor.execute(shortcutConfig);
    },
    onNotify: (title, body) => {
      // Delay notification to avoid race with startup
      setTimeout(() => showNotification(title, body), 2000);
    },
  });

  registerShortcuts();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in background
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (shortcutService) {
    shortcutService.dispose();
  } else {
    globalShortcut.unregisterAll();
  }
});
