---
kind: external_dependency
name: DeepSeek 大模型 API 提供方
slug: deepseek
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
source_files:
    - src/main.js
    - docs/adr/0002-multi-provider-architecture.md
---

Prompt Go 当前默认使用的 AI 模型提供方，通过 OpenAI 兼容的 `/v1/chat/completions` 端点发起流式 SSE 请求。当前支持的模型为 `deepseek-v4-flash`（默认）和 `deepseek-v4-pro`，旧模型名 `deepseek-chat` / `deepseek-reasoner` 已于 2026/07/24 弃用。API Key 在设置界面配置后存入 electron-store。未来将扩展为多 Provider 架构，支持 Ollama 与 Custom OpenAI 兼容端点。
- 调用参数包含 `temperature`、`repetition_penalty` 等控制重复退化的参数
- 流式响应通过 SSE 解析并逐块写入输出目标