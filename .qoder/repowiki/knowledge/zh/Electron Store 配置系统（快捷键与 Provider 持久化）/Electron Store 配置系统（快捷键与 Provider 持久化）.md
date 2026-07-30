---
kind: configuration_system
name: Electron Store 配置系统（快捷键与 Provider 持久化）
category: configuration_system
scope:
    - '**'
source_files:
    - src/main.js
    - src/preload.js
    - src/shortcut-service.js
    - src/provider.js
    - src/settings.html
---

本项目的配置系统基于 Electron 官方库 `electron-store`，将用户配置（快捷键、提示模板、AI Provider）以 JSON 形式持久化到本地文件。配置加载、迁移、IPC 暴露和运行时验证构成了完整的配置生命周期。

**核心机制**
- 主进程在启动时通过 `new Store({ defaults: {...} })` 初始化配置存储，默认包含空的 `providers` 数组和两条预设快捷键（整理文本内容、翻译成英文），每条快捷键含 id、name、shortcut、template 字段。
- 应用启动时执行两次迁移：`migrateTemplates()` 将旧版 `{{select_content}}` 模板变量替换为新版 `@select_content`；`migrateProviders()` 将单 apiKey 结构迁移为多 provider 架构，并删除旧的 `apiKey` 字段。
- 渲染器通过 `preload.js` 使用 `contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露受限 IPC 方法（getConfig、saveProvider、deleteProvider、validateProvider 等），禁止直接访问 `ipcRenderer`。
- 所有配置读写均通过 `main.js` 中的 `ipcMain.handle` 路由，由主进程统一调用 store.get/set，保证数据一致性。

**配置数据结构**
- `providers`: Provider 对象数组，每个对象包含 id、name、type（deepseek/ollama/custom）、model，以及可选的 apiKey、baseUrl。
- `shortcuts`: 快捷键对象数组，每个对象包含 id、name、shortcut（Electron accelerator 字符串）、template（提示模板，必须包含 `@select_content` 变量）、providerId（关联 provider）。
- Provider 配置由 `provider.js` 中的 `validateProviderConfig` 校验，不同 type 有不同必填字段要求。

**快捷键注册与冲突处理**
- `ShortcutService` 通过注入的 `createElectronRegistrar` 和 `createElectronStore` 适配器封装 Electron 全局快捷键 API 和 electron-store。
- 启动时调用 `registerAllAtStartup()` 先 `unregisterAll()` 再逐个注册，失败的快捷键记录为 `_inactiveIds` 并在 UI 中标记为 inactive。
- `checkAvailability()` 提供无副作用的可用性检查，依次验证格式（至少两个修饰键+一个普通键）、内部冲突（已保存或已注册的快捷键）、外部冲突（尝试临时注册探测）。
- `recommendShortcut()` 生成候选快捷键池（保持原主键添加修饰键、邻近数字/字母、固定低冲突池 Control+Option/[Shift]+[0-9A-Z]），按顺序探测第一个可用的返回。
- `saveShortcut()` 实现原子性保存：先重新检查可用性，编辑模式下先注册新快捷键再注销旧的，成功后才持久化到 store。

**运行时依赖注入模式**
- 主进程通过构造函数注入 registrar、store、onTrigger、onNotify 等依赖，使 ShortcutService 可被单元测试完全隔离（测试中使用内存 store 和模拟 registrar）。
- Provider 请求构建由 `buildRequestConfig` 根据 type 动态组装 URL、headers 和 body，支持 DeepSeek、Ollama 和自定义 OpenAI 兼容接口。

**约束与约定**
- 快捷键必须满足 Electron accelerator 规范，至少两个修饰键（Control/Alt/Shift/Command）加一个普通键。
- 提示模板必须包含 `@select_content` 变量，否则保存时报错。
- Provider 类型仅限 deepseek、ollama、custom 三种，每种有特定必填字段。
- 配置迁移在每次启动时幂等执行，避免重复迁移。
- macOS 上需要辅助功能权限才能读取选中文本，应用启动时检测并引导用户授权。