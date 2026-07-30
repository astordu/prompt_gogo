---
kind: external_dependency
name: HTTP 客户端 axios
slug: axios
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
source_files:
    - package.json
---

用于向 AI 模型提供方发起 HTTP 请求的库，支持流式 SSE 响应处理。在 processWithAI 函数中调用 DeepSeek API，后续将扩展为多 Provider 抽象，统一不同提供方的连接配置和请求格式。