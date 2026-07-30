---
kind: external_dependency
name: Electron 桌面应用框架
slug: electron
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
source_files:
    - package.json
    - README.md
---

Prompt Go 基于 Electron 构建 macOS 桌面应用，主进程负责全局快捷键注册、窗口管理和系统 API 调用（剪贴板、通知），渲染进程提供设置界面。预加载脚本建立安全 IPC 桥接。应用打包为 DMG 格式分发，需用户手动清除未签名应用的隔离标记后才能运行。