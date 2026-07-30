---
kind: logging_system
name: 基于 console.log 的轻量级日志输出
category: logging_system
scope:
    - '**'
source_files:
    - src/main.js
    - diagnose.js
---

该仓库未引入任何第三方日志框架（如 winston、pino、bunyan、log4js 等），也没有独立的 log/ 或 logging/ 目录。整个应用的日志输出完全依赖 Node.js/Electron 内置的 `console` 对象，属于最基础的 stdout 打印方式。

**使用方式与分布**
- 主进程 `src/main.js` 中使用 `console.log`、`console.warn` 输出应用启动、快捷键注册、权限检查、模板/Provider 迁移等关键流程信息，并配合 emoji（✅、⚠️、📌、💡、🎉）增强可读性。
- 诊断脚本 `diagnose.js` 同样仅用 `console.log` 输出测试步骤和结果。
- 其他业务模块（shortcut-service、run/*、provider、template 等）未发现显式日志调用，错误通过 IPC 返回值或 UI 通知反馈。

**日志级别与结构化程度**
- 未定义统一的日志级别策略，仅混用 `console.log` 与 `console.warn`。
- 无结构化字段（如 timestamp、level、module、correlationId 等），所有输出均为纯文本拼接字符串。
- 无日志文件写入、无远程收集、无控制台过滤开关。

**约束与约定**
- 由于没有集中式 logger 抽象，各模块自行决定何时打印，不存在强制规范。
- 测试套件基于 `node:test`，断言失败直接抛出异常，不依赖日志输出进行验证。

综上，本项目属于「低成熟度」日志实践：仅有零散的 `console.log` 调试输出，未形成可复用、可配置、可路由的日志系统。