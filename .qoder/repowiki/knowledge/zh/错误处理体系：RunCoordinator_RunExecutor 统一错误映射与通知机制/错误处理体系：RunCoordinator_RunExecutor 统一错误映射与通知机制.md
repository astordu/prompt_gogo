---
kind: error_handling
name: 错误处理体系：RunCoordinator/RunExecutor 统一错误映射与通知机制
category: error_handling
scope:
    - '**'
source_files:
    - src/run/run-coordinator.js
    - src/run/run-executor.js
    - src/run/stream-output.js
    - src/run/clipboard-sink.js
    - src/main.js
    - src/provider.js
    - test/run/run-executor.test.js
---

## 1. 系统/方法概述
本项目采用「协调器 + 执行器」分层架构，将错误处理集中在 RunCoordinator（运行生命周期管理）和 RunExecutor（单条快捷键→AI 流式请求编排）中。所有用户可见的错误通过统一的 `onNotify(title, body)` 回调以 Electron Notification 形式呈现；内部异常则通过 Promise reject / throw Error 在调用链中传播，由上层 try/catch 捕获并映射为中文提示。

- 主进程 `main.js` 中的 IPC 校验接口 `validate-provider` 使用 try/catch + axios 响应码分类（401/404/ECONNREFUSED/ECONNABORTED），返回 `{ success, error }` 结构。
- `provider.js` 的 `buildRequestConfig` 对未知 provider type 直接 `throw new Error(...)`，配置校验函数 `validateProviderConfig` 返回 `{ valid, errors[] }` 而非抛错。
- 渲染器 `renderer.js` 中对 Ollama 模型列表获取使用 `try { fetch(...) } catch { ... }` 降级到手动输入模式，并在 HTTP 非 ok 时 `throw new Error('HTTP ${status}')`。

## 2. 核心文件与位置
- `src/run/run-coordinator.js` — 运行协调器，定义 Loading/Ending 指示器、取消信号 AbortController、输出目标失效检测、以及 `cancel()`/`endRun()` 等状态机方法。
- `src/run/run-executor.js` — 运行执行器，串联文本读取、模板替换、Provider 校验、SSE 流式写入、错误映射 `_notifyError`，是错误处理的集中编排点。
- `src/run/stream-output.js` — 流式管道 `pipeToCursor`，支持 AbortSignal 中断、超时缓冲 flush，确保取消时不残留部分写入。
- `src/run/clipboard-sink.js` — 剪贴板 Sink，close 时条件恢复原始剪贴板内容，避免 Run 期间用户覆盖导致的丢失。
- `src/main.js` — IPC handler `validate-provider` 对网络错误进行分类映射；`createModelRequestAdapter` 通过 axios 发起 SSE 请求。
- `src/provider.js` — Provider 配置构建与校验，失败路径返回结构化错误数组。
- `test/run/run-executor.test.js` — 覆盖取消、目标失效、Provider 缺失/无效、空输入、空内容、HTTP 401/429/500、超时等错误场景的断言。

## 3. 架构与约定
- **统一通知通道**：所有模块通过注入的 `onNotify(title, body)` 回调上报错误，测试中使用 `createFakeNotifier` 收集通知标题与正文进行断言。
- **AbortController 贯穿**：RunCoordinator 持有 `_abortController`，`getAbortSignal()` 暴露给 `sendModelRequest` 和 `pipeToCursor`，实现从快捷键取消 → HTTP 中止 → 流式管道停止的端到端中断。
- **输出目标有效性检查**：每次写/删/恢复前调用 `coordinator.validateTarget()`，若目标已失焦或应用切换，标记 `_targetInvalid` 并通过通知告知用户“输出目标已失效”。
- **错误分类映射**：`_notifyError` 根据 `error.response.status`（401/429/≥500）、`error.code`（ECONNABORTED）或 `error.message` 生成不同中文提示，兜底为 `错误: ${message}`。
- **Loading/Ending 安全回滚**：取消发生在首次内容到达前时调用 `abortLoading()` 删除 S 指示器并恢复原始选中文本；正常完成时显示 E 指示器并保持 500ms 后移除。
- **互斥执行**：`beginRun()` 拒绝并发 Run，返回 false 时立即通知“已有运行任务”，保证同一时刻仅一个快捷键任务活跃。

## 4. 约定与约束
- Provider 配置校验必须返回 `{ valid, errors[] }` 结构，禁止直接抛错（见 `validateProviderConfig`）。
- 所有异步 I/O（axios、fetch、clipboard、osascript）均包裹 try/catch，并将异常映射为用户可读的中文通知。
- 流式管道必须在 finally 中调用 `sink.close()`，即使被 AbortSignal 中断也不跳过清理。
- 剪贴板 Sink 仅在 close 时恢复原始内容，且仅当当前剪贴板仍等于最后一次写入值时才恢复，避免覆盖用户新复制的内容。
- 测试强制覆盖以下错误路径：Provider 缺失/无效、空输入、空模型内容、HTTP 401/429/500、超时、取消、输出目标失效、并发拒绝等，作为错误行为的契约保障。
