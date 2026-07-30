---
kind: build_system
name: Electron + electron-builder 构建与发布系统
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - .github/workflows/verify.yml.bak
    - .github/workflows/openissues_handle.yml
---

本项目采用基于 Node.js 的 Electron 桌面应用构建体系，核心由 `package.json` 中的 npm scripts 与 `electron-builder` 配置驱动，配合 GitHub Actions 实现 CI 验证与自动化工作流。

**构建工具链**
- 开发运行：`npm start` / `npm run dev` 通过 `electron .` 启动主进程（`src/main.js`）
- 打包发布：`npm run dist` 执行 `electron-builder --mac dmg` 生成 macOS DMG 安装包；`npm run build` 调用默认 electron-builder 流程
- 测试覆盖：`npm test` 使用 Node.js 内置 `node:test` 框架运行 `test/*.test.js` 与 `test/run/*.test.js`；`npm run coverage` 通过 `c8` 生成 HTML/文本覆盖率报告
- 代码质量：`npm run lint`（ESLint）、`npm run typecheck`（TypeScript 类型检查）、`npm run verify` 串联 lint + typecheck + 覆盖率门禁（行覆盖率 ≥ 60%）

**打包配置（electron-builder）**
- 应用标识：`appId: com.promptgogo.app`，产品名称 `Prompt Go`
- 目标平台：仅 macOS，输出格式为 `dmg`，图标位于 `build/icon.png`（需手动准备）
- 产物目录：`dist/`
- 打包文件：仅包含 `src/**/*` 和 `package.json`，最小化依赖体积
- 签名：`identity: null`，未配置代码签名

**CI/CD 流水线（GitHub Actions）**
- `verify.yml.bak`：PR/推送触发，在自托管 macOS ARM64 Runner 上执行 `npm ci` + `npm run verify`，并可选调用 Codex 进行代码审查
- `openissues_handle.yml`：Issue 创建时自动分诊，支持 `qodercli`、`claude`、`codex` 三种 AI Agent 适配器，根据 `ADAPTER` 环境变量动态选择

**版本管理**
- 版本号集中在 `package.json` 的 `version` 字段（当前 1.0.0），electron-builder 打包时读取该值生成安装包名称

**约束与约定**
- 所有构建脚本均通过 npm scripts 统一入口，禁止直接调用底层工具
- 覆盖率门禁要求 src 目录下 JS 文件行覆盖率不低于 60%，否则 CI 失败
- 测试文件命名约定：`*.test.js`，按模块组织在 `test/` 与 `test/run/` 子目录
- CI 环境限定为 self-hosted macOS ARM64，不兼容其他平台 Runner