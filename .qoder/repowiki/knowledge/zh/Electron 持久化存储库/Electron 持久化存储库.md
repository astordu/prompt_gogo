---
kind: external_dependency
name: Electron 持久化存储库
slug: electron-store
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
source_files:
    - package.json
---

用于存储应用配置数据（API Key、快捷键设置、模板内容）的轻量级键值存储库。数据结构从单一 `{ apiKey, shortcuts }` 扩展为 `{ providers[], shortcuts[].providerId }` 以支持多 Provider 架构。启动时需执行数据迁移逻辑将旧格式转换为新格式。