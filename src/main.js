const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');
const { pipeToCursor } = require('./stream-output');
const { createClipboardSink } = require('./clipboard-sink');

// Initialize config store
const store = new Store({
  defaults: {
    apiKey: '',
    shortcuts: [
      {
        id: '1',
        name: '整理文本内容',
        shortcut: 'Control+Alt+9',
        template: '将以下内容整理成语句通顺，有条理的内容，可以改变语言表达方式，增加适当的标点符号：\n\n{{select_content}}\n\n注意：\n1.输出纯文本文本格式，不要使用markdown格式\n2.不要有回车，要是一段文本\n3.不要输出解释内容，直接输出整理后的内容。'
      },
      {
        id: '2',
        name: '翻译成英文',
        shortcut: 'Control+Alt+0',
        template: '请将下面这段中文文本翻译成英文。只输出翻译结果，不要有任何解释、说明或额外内容：\n\n{{select_content}}\n\n要求：直接输出英文翻译，一段完整的句子，不要换行，不要markdown格式。'
      }
    ]
  }
});

let mainWindow = null;
let tray = null;

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

function registerShortcuts() {
  console.log('\n========================================');
  console.log('📌 开始注册快捷键...');
  console.log('========================================');

  // Unregister all existing shortcuts
  globalShortcut.unregisterAll();

  const shortcuts = store.get('shortcuts');
  console.log(`📋 共有 ${shortcuts.length} 个快捷键需要注册`);

  const registeredShortcuts = [];
  const failedShortcuts = [];

  shortcuts.forEach((shortcutConfig) => {
    try {
      // Check if shortcut is already registered in this session
      if (registeredShortcuts.includes(shortcutConfig.shortcut)) {
        console.warn(`Duplicate shortcut detected: ${shortcutConfig.shortcut}`);
        failedShortcuts.push(shortcutConfig.name);
        return;
      }

      const success = globalShortcut.register(shortcutConfig.shortcut, () => {
        console.log(`\n🎯 快捷键回调被触发了！快捷键: ${shortcutConfig.shortcut}`);
        handleShortcutTrigger(shortcutConfig);
      });

      if (!success) {
        console.error(`❌ 失败: ${shortcutConfig.shortcut} for ${shortcutConfig.name} (可能被其他应用占用)`);
        failedShortcuts.push(shortcutConfig.name);
      } else {
        registeredShortcuts.push(shortcutConfig.shortcut);
        console.log(`✅ 成功: ${shortcutConfig.shortcut} → ${shortcutConfig.name}`);

        // Verify registration
        const isRegistered = globalShortcut.isRegistered(shortcutConfig.shortcut);
        console.log(`   验证: ${isRegistered ? '✓ 已确认注册' : '✗ 注册验证失败'}`);
      }
    } catch (error) {
      console.error(`Error registering shortcut ${shortcutConfig.shortcut}:`, error);
      failedShortcuts.push(shortcutConfig.name);
    }
  });

  console.log('========================================');
  console.log(`✅ 快捷键注册完成: ${registeredShortcuts.length} 个成功, ${failedShortcuts.length} 个失败`);
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

  // Notify user if any shortcuts failed to register
  if (failedShortcuts.length > 0) {
    setTimeout(() => {
      showNotification(
        '快捷键注册失败',
        `以下快捷键无法注册: ${failedShortcuts.join(', ')}。可能被其他应用占用。`
      );
    }, 2000);
  }
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

  const { execSync } = require('child_process');

  console.log('\n步骤 1: 准备读取选中文本');

  let selectedText = '';

  // 方法1: 尝试使用 Accessibility API 直接读取选中文本
  console.log('\n步骤 2: 使用 Accessibility API 读取选中文本');
  console.log('🔍 直接从应用获取选中内容 (不使用剪贴板)...');

  try {
    // 方法1: 创建临时 AppleScript 文件来避免引号问题
    const fs = require('fs');
    const os = require('os');
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

    // 写入临时文件
    fs.writeFileSync(scriptPath, appleScriptContent, 'utf8');

    // 执行 AppleScript 文件
    const result = execSync(`osascript "${scriptPath}"`, {
      encoding: 'utf8',
      timeout: 2000
    }).trim();

    // 删除临时文件
    try {
      fs.unlinkSync(scriptPath);
    } catch (e) {
      // 忽略删除错误
    }

    console.log(`📝 Accessibility API 返回: "${result.substring(0, 100)}${result.length > 100 ? '...' : ''}"`);

    // 检查是否成功获取
    if (result && !result.startsWith('ERROR:') && result.trim() !== '') {
      selectedText = result;
      console.log(`✅ 成功通过 Accessibility API 获取文本 (${selectedText.length} 字符)`);
      console.log('💡 这是最可靠的方法，不依赖剪贴板！');
    } else {
      console.log(`⚠️ Accessibility API 失败: ${result}`);
      console.log('💡 原因可能是：');
      console.log('   • 当前应用不支持 AXSelectedText 属性');
      console.log('   • 没有选中任何文本');
      console.log('   • 缺少辅助功能权限');
      console.log('\n🔄 回退到剪贴板方法...');

      // 方法2: 回退到剪贴板方法
      selectedText = await fallbackToClipboard();
    }
  } catch (error) {
    console.error(`❌ Accessibility API 调用异常: ${error.message}`);
    console.log('🔄 回退到剪贴板方法...');

    // 方法2: 回退到剪贴板方法
    selectedText = await fallbackToClipboard();
  }

  // 检查最终结果
  if (!selectedText || selectedText.trim() === '') {
    console.log('\n❌ 所有方法均失败，未能获取选中文本');
    console.log('💡 建议：');
    console.log('   ① 确保文本已被选中（高亮显示）');
    console.log('   ② 或者先 Cmd+C 复制，再按快捷键');
    console.log('   ③ 检查是否授予了辅助功能权限');

    showNotification('未能获取文本', '请确保文本已选中\n或先 Cmd+C 复制后再试');
    return;
  }

  console.log('\n步骤 3: 使用模板处理文本');
  console.log(`📋 模板: ${shortcutConfig.template.substring(0, 50)}...`);
  const prompt = shortcutConfig.template.replace('{{select_content}}', selectedText);

  // Step 4: Call DeepSeek API
  console.log('\n步骤 4: 调用 DeepSeek API');
  try {
    await processWithAI(prompt, shortcutConfig.name);
  } catch (error) {
    console.error('\n❌ 处理失败:', error.message);
  }
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

async function processWithAI(prompt, actionName) {
  const apiKey = store.get('apiKey');
  console.log('🔑 检查 API Key...');

  if (!apiKey) {
    console.error('❌ API Key 未配置');
    showNotification('API Key 缺失', '请在设置中配置您的 DeepSeek API key');
    showWindow();
    return;
  }

  console.log('✅ API Key 已配置');
  console.log(`🚀 发送流式请求到 DeepSeek API...`);
  console.log(`📝 Prompt 长度: ${prompt.length} 字符`);

  try {
    showNotification('处理中...', `正在运行: ${actionName}`);

    const startTime = Date.now();

    // 使用流式响应
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: prompt }
      ],
      stream: true,  // 开启流式输出
      temperature: 0.7
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      responseType: 'stream',  // 接收流式数据
      timeout: 60000 // 增加到 60 秒
    });

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
    async function* trackedChunks() {
      for await (const chunk of sseTextStream(response.data)) {
        collected.push(chunk);
        yield chunk;
      }
    }

    await pipeToCursor(trackedChunks(), createClipboardSink());

    const fullText = collected.join('');
    const elapsed = Date.now() - startTime;
    console.log(`\n✅ 流式响应完成 (总耗时: ${elapsed}ms)`);
    console.log(`📄 总共输出: ${fullText.length} 字符`);

    showNotification('成功', '内容已流式输出完成!');
    console.log('\n========================================');
    console.log('🎉 处理完成!');
    console.log('========================================\n');

  } catch (error) {
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
        console.error('原因: DeepSeek 服务器错误');
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
  return {
    apiKey: store.get('apiKey'),
    shortcuts: store.get('shortcuts')
  };
});

ipcMain.handle('save-api-key', (event, apiKey) => {
  store.set('apiKey', apiKey);
  return { success: true };
});

ipcMain.handle('validate-api-key', async (event, apiKey) => {
  try {
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'user', content: 'Hello' }
      ],
      max_tokens: 10
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
});

ipcMain.handle('get-shortcuts', () => {
  return store.get('shortcuts');
});

ipcMain.handle('save-shortcut', (event, shortcut) => {
  const shortcuts = store.get('shortcuts');
  const index = shortcuts.findIndex(s => s.id === shortcut.id);

  if (index >= 0) {
    shortcuts[index] = shortcut;
  } else {
    shortcuts.push(shortcut);
  }

  store.set('shortcuts', shortcuts);
  registerShortcuts(); // Re-register shortcuts

  return { success: true };
});

ipcMain.handle('delete-shortcut', (event, id) => {
  const shortcuts = store.get('shortcuts').filter(s => s.id !== id);
  store.set('shortcuts', shortcuts);
  registerShortcuts(); // Re-register shortcuts

  return { success: true };
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
  globalShortcut.unregisterAll();
});
