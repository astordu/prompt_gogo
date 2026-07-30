---
kind: external_dependency
name: GitHub Issues 问题跟踪器
slug: github-issues
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - AGENTS.md
    - docs/agents/issue-tracker.md
---

项目使用 GitHub Issues 作为规格文档和工单管理系统，remote 仓库为 `astordu/prompt_gogo`。通过 `gh` CLI 工具创建和管理 issue，配合 Matt Pocock 技能工作流进行需求分析、规格编写和任务拆分。Issue 标签遵循规范分诊流程：needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix。