---
kind: external_dependency
name: 本地 LLM 推理服务 Ollama
slug: ollama
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - docs/adr/0002-multi-provider-architecture.md
---

计划支持的本地 AI 模型提供方，运行在用户本机，免费但能力有限，适合简单文本处理任务。通过 OpenAI 兼容的 `/v1/chat/completions` 端点调用，模型列表通过 `/api/tags` 动态获取，失败时退化为手动输入。作为 Provider 类型之一，与 DeepSeek 并列供每个 Shortcut 独立绑定使用。