const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');
const { pipeToCursor } = require('./stream-output');
const { createClipboardSink } = require('./clipboard-sink');
const { replaceVariables } = require('./template');
const { buildRequestConfig, validateProviderConfig, migrateToProviders } = require('./provider');
const { ShortcutService, createElectronRegistrar, createElectronStore } = require('./shortcut-service');
const { RunCoordinator } = require('./run-coordinator');
const { createOutputTarget } = require('./output-target');
const { createRunIndicatorSink } = require('./run-indicator');

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

// Run coordinator (created in app.whenReady alongside shortcutService)
let runCoordinator = null;

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

async function handleShortcutTrigger(shortcutConfig) {
  console.log('\n========================================');
  console.log(`🔥 快捷键触发: ${shortcutConfig.name}`);
  console.log(`   快捷键: ${shortcutConfig.shortcut}`);
  console.log('========================================');

  // Check if running on macOS
  if (process.platform !== 'darwin') {
    console.error('❌ 错误: 不是 macOS 系统');
    showNotification('平台错误', '此功能仅支持 macOS 系统');
    return;
  }

  // Begin a single Run — rejected if one is already active
  if (!runCoordinator.beginRun()) {
    console.log('⏭️ 已有活动 Run，跳过本次触发');
    return;
  }

  try {
    const selectedText = await runCoordinator.readText();

    if (selectedText === null) {
      // Cancelled or target invalid during text read
      if (runCoordinator.isTargetInvalid()) {
        // Target invalid notification already sent by validateTarget
      } else {
        showNotification('已取消', '运行任务已取消');
      }
      return;
    }

    if (!selectedText || selectedText.trim() === '') {
      console.log('\n❌ 未能获取选中文本');
      showNotification('未能获取文本', '请确保文本已选中\n或先 Cmd+C 复制后再试');
      return;
    }

    console.log(`✅ 获取文本 (${selectedText.length} 字符)`);

    const prompt = replaceVariables(shortcutConfig.template, { select_content: selectedText });

    if (!runCoordinator.isViable()) {
      if (runCoordinator.isCancelled()) {
        showNotification('已取消', '运行任务已取消');
      }
      // Target invalid notification already sent by validateTarget
      return;
    }

    await processWithAI(prompt, shortcutConfig, selectedText);
  } catch (error) {
    console.error('\n❌ 处理失败:', error.message);
  } finally {
    runCoordinator.endRun();
  }
}

/**
 * Read the currently selected text using Accessibility API, falling
 * back to the clipboard method if needed.
 * @returns {Promise<string>}
 */
async function readSelectedText() {
  const { execSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');

  // Method 1: Accessibility API
  try {
    const scriptPath = path.join(os.tmpdir(), 'get-selected-text.scpt');

    const appleScriptContent = `tell application "System Events"
  set frontApp to first application process whose frontmost is true
  tell frontApp
    try
      if exists (attribute "AXFocusedUIElement") then
        set focusedElement to value of attribute "AXFocusedUIElement"
        if exists (attribute "AXSelectedText" of focusedElement) then
          return value of attribute "AXSelectedText" of focusedElement
        else
          return "ERROR:No AXSelectedText attribute"
        end if
      else
        return "ERROR:No focused element"
      end if
    on error errMsg
      return "ERROR:" & errMsg
    end try
  end tell
end tell`;

    fs.writeFileSync(scriptPath, appleScriptContent, 'utf8');

    const result = execSync(`osascript "${scriptPath}"`, {
      encoding: 'utf8',
      timeout: 2000
    }).trim();

    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // ignore
    }

    if (result && !result.startsWith('ERROR:') && result.trim() !== '') {
      return result;
    }
  } catch {
    // fall through to clipboard
  }

  // Method 2: Clipboard fallback
  return await fallbackToClipboard();
}

// 回退方法：使用剪贴板方式获取文本
async function fallbackToClipboard() {
  console.log('\n📋 使用剪贴板回退方案...');
  const { execSync } = require('child_process');

  try {
    // 模拟 Cmd+C
    console.log('⌨️ 发送 Cmd+C 命令...');
    execSync('osascript -e \'tell application "System Events" to keystroke "c" using command down\'');

    // 等待剪贴板更新
    console.log('⏱️ 等待 500ms...');
    await new Promise(resolve => setTimeout(resolve, 500));

    const selectedText = clipboard.readText();
    console.log(`📝 剪贴板内容: "${selectedText.substring(0, 50)}${selectedText.length > 50 ? '...' : ''}"`);

    if (selectedText && selectedText.trim() !== '') {
      console.log('✅ 剪贴板方法成功');
      return selectedText;
    } else {
      console.log('⚠️ 剪贴板方法也失败了');
      return '';
    }
  } catch (error) {
    console.error(`❌ 剪贴板方法异常: ${error.message}`);
    return '';
  }
}

async function processWithAI(prompt, shortcutConfig, originalSelectedText) {
  const provider = findProvider(shortcutConfig.providerId);
  const actionName = shortcutConfig.name;

  if (!provider) {
    console.error('❌ 未找到 Provider（请先在设置中配置模型提供方）');
    showNotification('Provider 缺失', `快捷键「${actionName}」未绑定模型提供方，请在设置中配置`);
    showWindow();
    return;
  }

  const validation = validateProviderConfig(provider);
  if (!validation.valid) {
    console.error('❌ Provider 配置不完整:', validation.errors.join(', '));
    showNotification('Provider 配置不完整', validation.errors.join('\n'));
    showWindow();
    return;
  }

  const requestConfig = buildRequestConfig(provider);

  // Show Loading… indicator before sending the request.
  // This replaces the original selected text with the Run Indicator.
  const loadingShown = await runCoordinator.showLoading(originalSelectedText || '');
  if (!loadingShown) {
    if (runCoordinator.isCancelled()) {
      showNotification('已取消', '运行任务已取消');
      return;
    }
    // Target invalid notification already sent by validateTarget
    return;
  }

  console.log(`🔑 Provider: ${provider.name} (${provider.type})`);
  console.log(`🚀 发送流式请求...`);
  console.log(`📝 Prompt 长度: ${prompt.length} 字符`);

  let firstContentHandled = false;

  try {
    const startTime = Date.now();
    const abortSignal = runCoordinator.getAbortSignal();

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
      signal: abortSignal || undefined
    });

    // Check if cancelled during the HTTP request
    if (runCoordinator.isCancelled()) {
      if (runCoordinator.isShowingLoading()) {
        await runCoordinator.abortLoading();
      }
      showNotification('已取消', '运行任务已取消');
      // Destroy the response stream to stop consuming
      response.data.destroy();
      return;
    }

    console.log('✅ 开始接收流式响应...');
    console.log('⌨️ 开始流式输出到光标位置...');

    // TODO: 候选项④落地后删除
    async function* sseTextStream(responseStream) {
      let leftover = '';
      for await (const chunk of responseStream) {
        const lines = (leftover + chunk.toString()).split('\n');
        leftover = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
      if (leftover) {
        const line = leftover;
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data !== '[DONE]') {
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) yield content;
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    }

    const collected = [];
    let responseDestroyed = false;
    async function* trackedChunks() {
      for await (const chunk of sseTextStream(response.data)) {
        // Check for cancellation at every iteration
        if (runCoordinator.isCancelled()) {
          // Stop consuming the SSE stream
          if (!responseDestroyed) {
            responseDestroyed = true;
            response.data.destroy();
          }
          // If still in Loading phase, abort and restore original text
          if (runCoordinator.isShowingLoading()) {
            await runCoordinator.abortLoading();
          }
          // Discard this chunk and stop
          return;
        }

        // Handle the Loading indicator transition on first non-empty content
        if (!firstContentHandled && chunk) {
          const cleared = await runCoordinator.onModelContent(chunk);
          if (!cleared) {
            // Loading was not cleared — either cancelled or target invalid
            if (runCoordinator.isCancelled()) {
              await runCoordinator.abortLoading();
            }
            return;
          }
          firstContentHandled = cleared;
        }

        // Re-check cancellation after the async Loading transition
        if (runCoordinator.isCancelled()) {
          if (!responseDestroyed) {
            responseDestroyed = true;
            response.data.destroy();
          }
          return;
        }

        collected.push(chunk);
        yield chunk;
      }
    }

    // Wrap the clipboard sink with target validation: each write
    // checks that the Output Target is still valid before pasting.
    const baseSink = createClipboardSink();
    const validatingSink = {
      async write(text) {
        if (!runCoordinator.validateTarget()) {
          throw new Error('Output Target invalid');
        }
        await baseSink.write(text);
      },
      async close() {
        await baseSink.close();
      },
    };

    await pipeToCursor(trackedChunks(), validatingSink, abortSignal);

    // After streaming completes, check if the Run was cancelled
    if (runCoordinator.isCancelled()) {
      // Already-written content is preserved; just send cancel notification
      // (not if it was cancelled during Loading — that was handled above)
      if (firstContentHandled) {
        showNotification('已取消', '运行任务已取消');
      }
      return;
    }

    // Check if target became invalid during streaming
    if (runCoordinator.isTargetInvalid()) {
      // Target invalid notification already sent by validateTarget
      return;
    }

    // Normal completion: if we received non-empty model content,
    // show Ending… for 500ms as a brief completion indicator.
    if (runCoordinator.hasModelContent()) {
      const endingResult = await runCoordinator.showEnding();
      // showEnding handles cancel during the hold period internally:
      // if cancelled during Ending, it removes the indicator and
      // treats the Run as successful (no cancel notification).
      if (!endingResult && runCoordinator.isTargetInvalid()) {
        // Target became invalid during Ending — notification already sent
        return;
      }
      // If endingResult is false due to cancellation during Ending,
      // the Run completed successfully — fall through to success.
    } else {
      // No model content received — treat as failure
      if (runCoordinator.isShowingLoading()) {
        await runCoordinator.abortLoading();
      }
      showNotification('错误', '未收到任何模型内容');
      return;
    }

    const fullText = collected.join('');
    const elapsed = Date.now() - startTime;
    console.log(`\n✅ 流式响应完成 (总耗时: ${elapsed}ms)`);
    console.log(`📄 总共输出: ${fullText.length} 字符`);

    console.log('\n========================================');
    console.log('🎉 处理完成!');
    console.log('========================================\n');

  } catch (error) {
    // Handle cancellation errors from axios (AbortSignal)
    if (axios.isCancel && axios.isCancel(error)) {
      if (runCoordinator.isShowingLoading()) {
        await runCoordinator.abortLoading();
      }
      // Already-written content (if any) is preserved
      showNotification('已取消', '运行任务已取消');
      return;
    }

    if (error.message === 'Output Target invalid') {
      // Target invalid notification already sent by validateTarget
      console.log('\n⚠️ Output Target 已失效，停止写入');
      // If Loading is still active, try to abort (may fail if target invalid)
      if (runCoordinator.isShowingLoading()) {
        await runCoordinator.abortLoading();
      }
      return;
    }

    // If we haven't received any model content yet, abort Loading
    // and restore the original text.
    // If partial content was already written, it is preserved —
    // no Ending… or Error… inline text is inserted.
    if (runCoordinator.isShowingLoading()) {
      await runCoordinator.abortLoading();
    }

    // Don't show error notification if cancelled (cancel path handles its own notification)
    if (runCoordinator.isCancelled()) {
      return;
    }

    console.error('\n========================================');
    console.error('❌ API 调用失败');
    console.error('========================================');
    console.error('错误详情:', error.response?.data || error.message);

    let errorMessage = '处理文本失败';
    if (error.response) {
      console.error(`HTTP 状态码: ${error.response.status}`);
      if (error.response.status === 401) {
        errorMessage = 'API Key 无效，请检查您的配置';
        console.error('原因: API Key 无效或已过期');
      } else if (error.response.status === 429) {
        errorMessage = 'API 请求次数超限，请稍后重试';
        console.error('原因: 超过 API 调用频率限制');
      } else if (error.response.status >= 500) {
        errorMessage = 'API 服务暂时不可用，请稍后重试';
        console.error('原因: 服务器错误');
      }
    } else if (error.code === 'ECONNABORTED') {
      errorMessage = '请求超时，请检查网络连接';
      console.error('原因: 请求超过 30 秒超时');
    } else if (error.message) {
      errorMessage = `错误: ${error.message}`;
      console.error('原因:', error.message);
    }

    showNotification('错误', errorMessage);
    console.error('========================================\n');
  }
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

  // Create the run coordinator with globalShortcut as the cancel registrar
  runCoordinator = new RunCoordinator({
    cancelRegistrar: {
      register(accelerator, callback) {
        return globalShortcut.register(accelerator, callback);
      },
      unregister(accelerator) {
        globalShortcut.unregister(accelerator);
      },
    },
    onNotify: (title, body) => showNotification(title, body),
    readSelectedText: () => readSelectedText(),
    outputTarget: createOutputTarget(),
    runIndicator: createRunIndicatorSink({ clipboard }),
  });

  // Create the shortcut management service with injectable dependencies
  shortcutService = new ShortcutService({
    registrar: createElectronRegistrar(globalShortcut),
    store: createElectronStore(store),
    onTrigger: (shortcutConfig) => {
      handleShortcutTrigger(shortcutConfig);
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
