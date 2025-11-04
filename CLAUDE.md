# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prompt Go is a desktop application for Mac (Electron-based) that enables quick text processing using keyboard shortcuts and AI-powered prompt templates. Users can select text anywhere on their system, trigger a configured shortcut, and have the text processed by DeepSeek AI according to predefined templates.

**Current Status**: Fully implemented MVP with all core features working.

## Development Commands

- `npm install` - Install dependencies
- `npm start` - Run the application
- `npm run dev` - Run in development mode

## Technical Stack

- **Framework**: Electron 28
- **Platform**: macOS (MVP - first version)
- **AI Provider**: DeepSeek API (via axios)
- **UI**: HTML/CSS with Tailwind CSS CDN, dark mode support
- **Storage**: electron-store for configuration persistence

## Core Architecture

### Key Components

1. **Configuration System** (`src/main.js`)
   - API key management for DeepSeek using electron-store
   - Shortcut-to-template mapping storage
   - Default shortcuts provided on first run
   - Settings UI (`src/settings.html`)

2. **Global Shortcut Handler** (`src/main.js`)
   - System-wide keyboard shortcut registration via Electron's globalShortcut API
   - Text selection capture using AppleScript (macOS-specific)
   - Clipboard manipulation to copy selected text
   - Shortcut-to-action routing

3. **Template Engine** (`src/main.js`)
   - All templates MUST include `{{select_content}}` placeholder
   - Simple string replacement for template variables
   - Validation in frontend (`src/renderer.js`)

4. **AI Integration** (`src/main.js`)
   - DeepSeek API client using axios
   - POST requests to `https://api.deepseek.com/v1/chat/completions`
   - Result copied to clipboard automatically
   - Native notifications for user feedback

## File Structure

```
src/
├── main.js          # Main process: window management, shortcuts, API calls
├── preload.js       # IPC bridge (contextBridge) for secure communication
├── renderer.js      # Frontend logic: settings UI, form handling
└── settings.html    # Settings interface with Tailwind CSS
```

## IPC Communication

The app uses Electron's IPC for secure communication:

- `get-config` - Load API key and shortcuts
- `save-api-key` - Save and persist API key
- `validate-api-key` - Test API key with DeepSeek
- `get-shortcuts` - Retrieve all shortcuts
- `save-shortcut` - Add or update a shortcut (re-registers global shortcuts)
- `delete-shortcut` - Remove a shortcut (re-registers global shortcuts)

### Text Processing Flow

1. User selects text in any application
2. User triggers configured keyboard shortcut (e.g., Cmd+Shift+1)
3. System captures selected text
4. Corresponding prompt template is retrieved
5. Selected text replaces `{{select_content}}` in template
6. Request sent to DeepSeek API
7. Processed result returned to user

## Design Files

- `docs/PRD.md` - Chinese language product requirements document
- `docs/html/code.html` - Settings page UI mockup with:
  - API key configuration section
  - Shortcuts & prompts management table
  - Modal for editing prompt templates
  - Dark mode theme support
  - Tailwind CSS styling

## Important Template Convention

Every prompt template in the system must contain the `{{select_content}}` field. This is where user-selected text will be inserted. Templates without this placeholder will not function correctly.

## Example Use Cases

- **Cmd+Shift+1**: Summarize selected text
- **Cmd+Shift+2**: Translate to Spanish
- **Cmd+Shift+3**: Explain code
