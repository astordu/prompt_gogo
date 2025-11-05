# Prompt Go

A macOS desktop application for processing selected text using AI-powered prompts and keyboard shortcuts.

## Features

- **Global Keyboard Shortcuts**: Trigger AI text processing from any application
- **Customizable Prompts**: Define your own prompt templates with the `{{select_content}}` placeholder
- **DeepSeek AI Integration**: Powered by DeepSeek's language models
- **Settings UI**: Easy-to-use interface for managing API keys and shortcuts
- **Dark Mode**: Beautiful dark mode interface

## Quick Start

### For End Users (Using DMG)

#### 安装步骤

由于应用未经过 Apple 签名，首次安装需要以下步骤：

1. **下载并打开 DMG 文件**
   - 双击 `Prompt Go-1.0.0-arm64.dmg`
   - 将 Prompt Go 拖入 Applications 文件夹

2. **首次打开应用** ⚠️ 重要
   - **不要直接双击打开**
   - 打开 Finder，进入 Applications 文件夹
   - 找到 Prompt Go 应用
   - **右键点击 (或 Control+点击)** → 选择 **"打开"**
   - 在弹出的对话框中，点击 **"打开"** 按钮
   - 以后就可以正常双击打开了

3. **配置辅助功能权限**
   - 首次运行会要求授予"辅助功能"权限
   - 打开 **系统设置** → **隐私与安全性** → **辅助功能**
   - 勾选 **Prompt Go**
   - 这是为了让应用能够捕获全局键盘快捷键和选中的文本

#### 故障排除

**问题：提示"无法打开应用，因为无法验证开发者"**
- 解决方法：使用"右键 → 打开"的方式首次启动（见上述步骤2）

**问题：快捷键不生效**
- 检查是否授予了"辅助功能"权限
- 确保快捷键没有与系统快捷键冲突
- 尝试重启应用

### For Developers

1. Clone this repository
2. Install dependencies:
```bash
npm install
```

### Configuration

1. Start the application:
```bash
npm start
```

2. In the Settings window:
   - Enter your DeepSeek API Key ([Get one here](https://platform.deepseek.com/api_keys))
   - Configure keyboard shortcuts and prompt templates
   - Each template must include `{{select_content}}` placeholder

### Usage

1. Select any text in any application
2. Press your configured keyboard shortcut (e.g., `Cmd+Shift+1`)
3. The app will:
   - Capture the selected text
   - Process it with DeepSeek AI using your prompt template
   - Copy the result to your clipboard
4. A notification will show when processing is complete

## Default Shortcuts

- **Cmd+Shift+1**: Summarize text
- **Cmd+Shift+2**: Translate to Spanish
- **Cmd+Shift+3**: Explain code

You can modify these or add new ones in the Settings.

## Development

```bash
# Start in development mode
npm run dev

# Start in production mode
npm start
```

## Architecture

- **Main Process** (`src/main.js`): Electron main process handling window management, global shortcuts, and API calls
- **Preload Script** (`src/preload.js`): Secure IPC bridge between main and renderer
- **Renderer Process** (`src/renderer.js`): Frontend logic for settings UI
- **Settings UI** (`src/settings.html`): Configuration interface

## Requirements

- macOS 10.15 or later
- Node.js 16 or later
- DeepSeek API key

## License

MIT
