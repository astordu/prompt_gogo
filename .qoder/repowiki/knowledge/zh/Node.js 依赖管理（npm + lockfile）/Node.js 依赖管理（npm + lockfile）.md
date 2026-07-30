---
kind: dependency_management
name: Node.js 依赖管理（npm + lockfile）
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
---

本项目使用 npm 作为包管理器，通过 `package.json` 声明运行时与开发时依赖，并通过 `package-lock.json`（lockfileVersion 3）锁定精确版本，确保构建可重现。

1. 使用的系统与工具
- 包管理器：npm（由 package-lock.json 生成与维护）
- 锁文件：package-lock.json，用于固定所有依赖及其子依赖的精确版本与完整性校验
- 打包工具：electron-builder 负责将应用打包为 macOS DMG
- 测试与覆盖率：node:test + c8
- 代码检查：eslint + typescript（仅类型检查）

2. 关键文件与包
- package.json：定义项目元信息、scripts、dependencies/devDependencies、electron-builder 配置
- package-lock.json：完整依赖树锁定，包含每个包的 resolved URL、integrity 校验和 node 引擎要求
- node_modules/：本地安装的依赖目录（未提交到版本控制）
- .gitignore：排除 node_modules 等构建产物

3. 架构与约定
- 依赖分类清晰：运行期依赖（axios、electron-store）与开发期依赖（electron、electron-builder、eslint、c8、jsdom、typescript）严格分离
- 版本策略：使用语义化版本范围（如 ^1.6.0、^28.0.0），允许小版本更新但禁止破坏性大版本升级
- 构建流程：通过 npm scripts 统一入口（start、dev、test、lint、typecheck、coverage、verify、dist、build），CI 可通过 verify 脚本执行完整验证链
- Electron 专用：electron-builder 配置在 package.json 的 build 字段中，指定 appId、productName、mac 目标、打包文件规则与输出目录

4. 约定与约束
- 所有第三方依赖必须通过 npm 安装并记录在 package.json 中，禁止手动修改 node_modules
- 依赖版本使用 ^ 前缀，遵循语义化版本控制，确保向后兼容的小版本更新
- package-lock.json 必须随 package.json 一起提交，保证团队与环境一致性
- 构建产物（node_modules、dist、coverage 等）不纳入版本控制
- 无私有仓库或 GOPRIVATE 配置，所有依赖均来自公开 npm 镜像（从 lockfile 中的 npmmirror.com 可见国内镜像加速）
- 无 vendoring 策略，依赖以标准 node_modules 方式管理