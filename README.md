# Prompt Go

A macOS desktop application for processing selected text using AI-powered prompts and keyboard shortcuts.

## Features

- **Global Keyboard Shortcuts**: Trigger AI text processing from any application
- **Customizable Prompts**: Define your own prompt templates with the `{{select_content}}` placeholder
- **DeepSeek AI Integration**: Powered by DeepSeek's language models
- **Settings UI**: Easy-to-use interface for managing API keys and shortcuts
- **Dark Mode**: Beautiful dark mode interface

## Quick Start

### Installation

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
