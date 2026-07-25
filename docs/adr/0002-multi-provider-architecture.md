# 多 Provider 架构：每个 Shortcut 绑定独立 Provider

应用从单一 DeepSeek 硬编码扩展为支持多 AI 模型（DeepSeek、Ollama、Custom OpenAI 兼容端点）。Provider 作为独立实体存在，Shortcut 通过 `providerId` 引用，允许不同快捷键使用不同模型（如本地 Ollama 处理简单任务、云端 DeepSeek 处理高质量任务）。

## Considered Options

- **全局单一 Provider**：所有 Shortcut 共享一个模型配置。否决原因：无法按场景分配本地/云端模型。
- **配置内联在 Shortcut 中**：每个 Shortcut 自带完整连接信息。否决原因：多个 Shortcut 用同一服务时需重复填写 API Key，维护成本高。
- **通用 OpenAI-Compatible 单一类型**：不区分类型，用户手填 Base URL。否决原因：普通用户不知道什么是 Base URL，体验差。

## Consequences

- 数据结构从 `{ apiKey, shortcuts }` 变为 `{ providers[], shortcuts[].providerId }`，需启动时自动迁移旧数据。
- 三种 Provider 类型底层均走 OpenAI 兼容的 `/v1/chat/completions` 流式调用，类型仅影响 UI 展示和默认值。
- 删除 Provider 时需检查引用计数，有 Shortcut 引用则禁止删除。
- Ollama 模型列表通过 `/api/tags` 动态获取，失败时退化为手动输入。
- DeepSeek 旧模型名（deepseek-chat/deepseek-reasoner）已于 2026/07/24 弃用，新配置使用 `deepseek-v4-flash`（默认）和 `deepseek-v4-pro`。
