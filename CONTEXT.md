# Prompt Go

macOS 全局 AI 提示词工具——用户选中任意应用中的文本，按下快捷键，AI 处理结果流式输出到光标位置。

## Language

**Template（提示模板）**:
一段包含零个或多个变量的提示词文本，与一个全局快捷键绑定。触发时，变量被替换为实际值后发送给 AI。
_Avoid_: Prompt, 提示, 模板

**Variable（变量）**:
模板中的一个命名占位符，触发时被动态值替换。书写语法为 `@变量名`（如 `@select_content`）。一个模板中同一变量可出现多次。
_Avoid_: Placeholder, 占位符, token, 标记

**Chip（胶囊）**:
变量在模板编辑器中的可视化形态——一个带背景色的内联原子元素，不可部分编辑，选中和删除均以整体为单位。
_Avoid_: Tag, badge, mention

**Completion Menu（候选菜单）**:
在模板编辑器中输入 `@` 后弹出的下拉列表，展示所有可用变量供用户选择。输入字符可过滤候选；无匹配时菜单消失。
_Avoid_: Dropdown, autocomplete, 下拉框

**Shortcut（快捷键）**:
一个全局键盘组合（如 Control+Alt+9），绑定一个 Template 和一个 Provider，在任意应用中可触发。
_Avoid_: Hotkey, 热键, keybinding

**Provider（模型提供方）**:
一个可复用的 AI 服务连接配置，包含类型（DeepSeek / Ollama / Custom）、连接地址、凭证和模型名。多个 Shortcut 可共享同一个 Provider。
_Avoid_: Service, 服务, backend, 后端, engine
