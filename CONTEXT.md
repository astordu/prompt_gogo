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
一个全局键盘组合（如 Control + Option + 9，显示为 `⌃⌥9`），绑定一个 Template 和一个 Provider，在任意应用中可触发。
_Avoid_: Hotkey, 热键, keybinding

**Shortcut Conflict（快捷键冲突）**:
候选快捷键无法注册。冲突的快捷键不可保存，但表单中的其他内容保持不变。
_Avoid_: Hotkey conflict, 按键冲突

**Internal Shortcut Conflict（内部快捷键冲突）**:
候选快捷键与本应用中的另一个 Shortcut 重复，可以明确指出占用它的 Shortcut。
_Avoid_: Duplicate hotkey, 重复按键

**External Shortcut Conflict（外部快捷键冲突）**:
候选快捷键无法向系统注册，可能已被 macOS 或其他应用占用，但无法可靠识别具体占用方。
_Avoid_: System conflict, 软件冲突

**Shortcut Recommendation（推荐快捷键）**:
发生 Shortcut Conflict 时提供的、已经过可注册性检测的替代 Shortcut。系统只展示建议，必须由用户主动采用，不得静默替换其输入。
_Avoid_: Suggested hotkey, 自动替换快捷键

**Shortcut Draft（快捷键草稿）**:
用户在添加或编辑过程中尚未保存的 Shortcut 配置。草稿不会影响当前生效的 Shortcut；只有检测通过并保存后才整体生效。
_Avoid_: Pending hotkey, 临时快捷键

**Shortcut Availability Check（快捷键可用性检测）**:
验证候选快捷键在当前时刻能否注册。完整组合键录入后执行一次，保存时再次执行；检测通过不代表该组合将永久可用。
_Avoid_: Conflict scan, 冲突扫描

**Invalid Shortcut（无效快捷键）**:
不满足全局 Shortcut 最低输入要求的键盘组合，至少需要两个修饰键和一个普通键。无效与 Shortcut Conflict 是不同状态，不进入可用性检测。
_Avoid_: Conflicting shortcut, 错误快捷键

**Unavailable Shortcut Check（无法检测快捷键）**:
应用暂时无法完成 Shortcut Availability Check，因而既不能断言候选快捷键发生冲突，也不能生成经过验证的 Shortcut Recommendation。
_Avoid_: External conflict, 检测失败冲突

**Inactive Shortcut（未生效快捷键）**:
已经保存、但在当前应用会话中因 Shortcut Conflict 而未能注册的 Shortcut。配置继续保留，但无法触发，并在设置列表中持续标记异常。
_Avoid_: Disabled shortcut, 已关闭快捷键

**Provider（模型提供方）**:
一个可复用的 AI 服务连接配置，包含类型（DeepSeek / Ollama / Custom）、连接地址、凭证和模型名。多个 Shortcut 可共享同一个 Provider。
_Avoid_: Service, 服务, backend, 后端, engine
