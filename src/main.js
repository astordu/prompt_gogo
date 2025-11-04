const { app, BrowserWindow, globalShortcut, clipboard, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');

// Initialize config store
const store = new Store({
  defaults: {
    apiKey: '',
    shortcuts: [
      {
        id: '1',
        name: '整理文本内容',
        shortcut: 'Command+Shift+0',
        template: '将以下内容整理成语句通顺，有条理的内容，可以改变语言表达方式，增加适当的标点符号：\n\n{{select_content}}\n\n注意：\n1.输出纯文本文本格式，不要使用markdown格式\n2.不要有回车，要是一段文本\n3.不要输出解释内容，直接输出整理后的内容。'
      },
      {
        id: '2',
        name: '翻译成英文',
        shortcut: 'Command+Shift+9',
        template: '你是一个专业的翻译助手。请将以下文本翻译成英文，保持原文的语气：\n\n{{select_content}}\n\n注意：\n1.输出纯文本文本格式，不要使用markdown格式\n2.不要有回车，要是一段文本\n3.不要输出解释内容，直接输出翻译后的内容。'
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
  // 移除立即显示的通知，避免焦点切换导致选中状态消失

  // Step 1: Get selected text from clipboard
  // First, we simulate Cmd+C to copy selected text
  const { exec } = require('child_process');

  // Check if running on macOS
  if (process.platform !== 'darwin') {
    console.error('❌ 错误: 不是 macOS 系统');
    showNotification('平台错误', '此功能仅支持 macOS 系统');
    return;
  }

  // Save current clipboard content
  const previousClipboard = clipboard.readText();
  console.log('\n步骤 1: 保存当前剪贴板内容');
  console.log(`📋 剪贴板内容 (前50字符): "${previousClipboard.substring(0, 50)}"`);

  // Immediately simulate Cmd+C (don't clear clipboard first, to maintain speed)
  console.log('\n步骤 2: 立即模拟 Cmd+C 复制选中文本');
  console.log('⌨️ 执行 AppleScript 命令（同步）...');

  const { execSync } = require('child_process');

  try {
    // Use sync execution for minimal delay
    execSync('osascript -e \'tell application "System Events" to keystroke "c" using command down\'');
    console.log('✅ Cmd+C 执行完成');

    // Wait very briefly for clipboard to update
    await new Promise(resolve => setTimeout(resolve, 100));

    const selectedText = clipboard.readText();
    console.log('\n步骤 3: 读取复制后的剪贴板内容');
    console.log(`📝 剪贴板内容 (前100字符): "${selectedText.substring(0, 100)}"`);

    if (!selectedText || selectedText.trim() === '') {
      console.log('\n⚠️ 剪贴板为空');
      showNotification('提示', '未捕获到文本。\n\n方法1: 选中文本后立即按快捷键\n方法2: 先 Cmd+C 复制文本，再按快捷键');
      return;
    }

    // Process even if clipboard unchanged (user may have copied text first)
    console.log('\n✅ 已捕获文本');
    console.log(`📏 文本长度: ${selectedText.length} 字符`);
    console.log('\n步骤 4: 使用模板处理文本');
    console.log(`📋 模板: ${shortcutConfig.template.substring(0, 50)}...`);
    const prompt = shortcutConfig.template.replace('{{select_content}}', selectedText);

    // Step 3: Call DeepSeek API
    console.log('\n步骤 5: 调用 DeepSeek API');
    try {
      await processWithAI(prompt, shortcutConfig.name, previousClipboard);
    } catch (error) {
      console.error('\n❌ 处理失败:', error.message);
      clipboard.writeText(previousClipboard);
      console.log('🔄 已恢复原剪贴板内容\n');
    }
  } catch (error) {
    console.error('\n❌ 复制操作失败:', error.message);
    showNotification('错误', `无法执行复制操作: ${error.message}`);
    return;
  }
}

async function processWithAI(prompt, actionName, previousClipboard = '') {
  const apiKey = store.get('apiKey');
  console.log('🔑 检查 API Key...');

  if (!apiKey) {
    console.error('❌ API Key 未配置');
    showNotification('API Key 缺失', '请在设置中配置您的 DeepSeek API key');
    showWindow();
    if (previousClipboard) {
      clipboard.writeText(previousClipboard);
      console.log('🔄 已恢复原剪贴板内容\n');
    }
    return;
  }

  console.log('✅ API Key 已配置');
  console.log(`🚀 发送流式请求到 DeepSeek API...`);
  console.log(`📝 Prompt 长度: ${prompt.length} 字符`);

  const { execSync } = require('child_process');

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

    let fullText = '';
    let buffer = '';

    // 用于流式粘贴的函数（使用剪贴板+Cmd+V，支持中文）
    const pasteText = (text) => {
      if (!text) return;

      try {
        // 写入剪贴板
        clipboard.writeText(text);

        // 模拟 Cmd+V 粘贴
        execSync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
      } catch (error) {
        console.error('⚠️ 粘贴失败:', error.message);
      }
    };

    // 监听流式数据
    response.data.on('data', (chunk) => {
      const lines = chunk.toString().split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();

          if (data === '[DONE]') {
            const elapsed = Date.now() - startTime;
            console.log(`\n✅ 流式响应完成 (总耗时: ${elapsed}ms)`);
            console.log(`📄 总共输出: ${fullText.length} 字符`);

            showNotification('成功', '内容已流式输出完成!');
            console.log('\n========================================');
            console.log('🎉 处理完成!');
            console.log('========================================\n');
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;

            if (content) {
              fullText += content;
              buffer += content;

              // 当缓冲区累积到一定长度时输出（批量粘贴更流畅）
              if (buffer.length >= 10) {  // 增加到10个字符，减少粘贴次数
                pasteText(buffer);
                process.stdout.write(buffer); // 终端也显示
                buffer = '';
              }
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    });

    response.data.on('end', () => {
      // 输出剩余缓冲区内容
      if (buffer.length > 0) {
        pasteText(buffer);
        process.stdout.write(buffer);
      }

      const elapsed = Date.now() - startTime;
      console.log(`\n\n✅ 流式响应结束 (总耗时: ${elapsed}ms)`);
      console.log(`📄 总字符数: ${fullText.length}`);

      // 恢复原剪贴板内容
      if (previousClipboard) {
        setTimeout(() => {
          clipboard.writeText(previousClipboard);
          console.log('🔄 已恢复原剪贴板内容');
        }, 500);
      }
    });

    response.data.on('error', (error) => {
      console.error('❌ 流式响应错误:', error.message);
      showNotification('错误', '流式输出中断');

      if (previousClipboard) {
        clipboard.writeText(previousClipboard);
        console.log('🔄 已恢复原剪贴板内容\n');
      }
    });

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

    // Restore previous clipboard on error
    if (previousClipboard) {
      clipboard.writeText(previousClipboard);
      console.log('🔄 已恢复原剪贴板内容\n');
    }
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
