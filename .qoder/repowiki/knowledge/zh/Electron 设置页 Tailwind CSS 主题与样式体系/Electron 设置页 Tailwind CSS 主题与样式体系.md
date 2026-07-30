---
kind: frontend_style
name: Electron 设置页 Tailwind CSS 主题与样式体系
category: frontend_style
scope:
    - '**'
source_files:
    - src/settings.html
    - src/renderer.js
---

本项目的 UI 样式集中在 Electron 渲染进程的设置页面 `src/settings.html` 中，采用 **Tailwind CSS（CDN 版本）** 作为核心样式框架，并通过内联 `<script id="tailwind-config">` 配置设计令牌。具体特点如下：

1. **样式系统**：通过 CDN 引入 Tailwind CSS 并启用 `forms`、`container-queries` 插件；在页面头部以 `tailwind.config` 对象定义主题扩展，包括颜色、字体族和圆角。
2. **设计令牌**：在 `theme.extend.colors` 中定义了完整的明暗双色调色板，包含 `primary`、`background-light/dark`、`surface-light/dark`、`card-light/dark`、`input-light/dark`、`border-light/dark`、`text-primary-light/dark`、`text-secondary-light/dark`、`success`、`danger` 等语义化颜色变量。
3. **深色模式**：使用 `darkMode: "class"` 策略，通过 HTML/Body 上的 `dark` 类切换明暗主题，所有组件均提供对应的 `dark:` 变体样式。
4. **自定义样式**：在 `<style>` 标签中补充了 Tailwind 未覆盖的组件样式，如 `.template-chip`（模板芯片）、`.completion-item`（补全菜单项）、编辑器占位符、模态框动画等。
5. **图标系统**：通过 Google Fonts 引入 Material Symbols Outlined 字体图标，在按钮、状态指示等处使用 `<span class="material-symbols-outlined">` 形式。
6. **响应式布局**：使用 Tailwind 的断点系统（sm/md/lg/xl）实现自适应布局，主容器最大宽度限制为 `max-w-[960px]`。
7. **组件结构**：HTML 结构清晰分层，包含 Provider 管理表格、快捷键配置表格、关于信息折叠区、权限指南、以及多个模态对话框（提示编辑、Provider 编辑）。
8. **JavaScript 动态样式**：`renderer.js` 中通过 `className` 属性动态设置元素样式，包括状态指示、补全菜单项、快捷键修饰键显示等。

该样式体系完全基于 HTML + Tailwind CSS + 少量内联 CSS 的传统 Web 方式，没有使用现代前端框架（React/Vue），而是直接在 Electron 渲染进程中操作 DOM。