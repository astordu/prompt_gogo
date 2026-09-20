#!/usr/bin/env python3
"""Ralph 单次运行脚本（Python 版本，对应 ralph/once.sh）。

用法: python once.py <qodercli|claude|codex>
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

RALPH_DIR = Path(__file__).resolve().parent
PROJECT_DIR = RALPH_DIR.parent
PROMPT_FILE = RALPH_DIR / "prompt.md"


def usage() -> None:
    print(f"Usage: {sys.argv[0]} <qodercli|claude|codex>", file=sys.stderr)


def run_agent(adapter: str, agent_prompt: str) -> None:
    if adapter == "qodercli":
        cmd = ["qodercli", "--model", "Qwen3.8-Max",
               "--permission-mode", "bypassPermissions", "-p", agent_prompt]
    elif adapter == "claude":
        cmd = ["claude", "--dangerously-skip-permissions", "-p", agent_prompt]
    else:  # codex
        cmd = ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", agent_prompt]
    # Windows 上 npm 全局命令是 .cmd shim，需要经 cmd 解释执行
    subprocess.run(cmd, cwd=PROJECT_DIR, shell=(sys.platform == "win32"))


def run_json_command(cmd: list[str]):
    """执行命令并把 stdout 解析为 JSON；失败返回 None（对应 shell 的 2>/dev/null || true）。"""
    try:
        completed = subprocess.run(cmd, cwd=PROJECT_DIR, capture_output=True,
                                   text=True, encoding="utf-8", errors="replace")
    except OSError:
        return None
    if completed.returncode != 0 or not completed.stdout.strip():
        return None
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError:
        return None


def fetch_issue_detail(iid) -> dict | None:
    """获取单个 issue 的完整详情（含评论）"""
    data = run_json_command(["glab", "issue", "view", str(iid), "-F", "json", "-c"])
    return data if isinstance(data, dict) else None


def fetch_issues_with_label(label: str) -> str:
    """获取带指定标签的 issues 完整详情（含评论）"""
    data = run_json_command(["glab", "issue", "list", "--label", label, "-O", "json"])
    if not isinstance(data, list) or not data:
        return "[]"
    details = []
    for item in data:
        if isinstance(item, dict) and "iid" in item:
            detail = fetch_issue_detail(item["iid"])
            if detail is not None:
                details.append(detail)
    return json.dumps(details, ensure_ascii=False)


def fetch_open_issue_summaries() -> str:
    """获取所有 open issues 的摘要"""
    data = run_json_command(["glab", "issue", "list", "-O", "json"])
    if not isinstance(data, list):
        return "[]"
    summaries = [
        {"iid": item.get("iid"), "title": item.get("title"), "labels": item.get("labels")}
        for item in data
        if isinstance(item, dict)
    ]
    return json.dumps(summaries, ensure_ascii=False)


def fetch_recent_commits(n: int = 5) -> str:
    """获取最近 n 次 commits 作为上下文"""
    try:
        completed = subprocess.run(
            ["git", "log", "-n", str(n), "--format=%H%n%ad%n%B---", "--date=short"],
            cwd=PROJECT_DIR, capture_output=True, text=True,
            encoding="utf-8", errors="replace")
    except OSError:
        return "No commits found"
    if completed.returncode != 0 or not completed.stdout.strip():
        return "No commits found"
    return completed.stdout.strip()


def main() -> int:
    adapter = sys.argv[1] if len(sys.argv) > 1 else ""
    if adapter not in ("qodercli", "claude", "codex"):
        usage()
        return 1

    print(f"=== Ralph (单次运行，{adapter}) ===")

    # 获取最近 commits 作为上下文
    commits = fetch_recent_commits()

    # 优先拉取 ready-for-agent 标签的 issues（含正文和评论）
    issues = fetch_issues_with_label("ready-for-agent")

    # 同时拉取其他 open issues（用于了解阻塞关系和全局状态）
    all_issues = fetch_open_issue_summaries()

    # 加载 prompt
    prompt = PROMPT_FILE.read_text(encoding="utf-8")

    # 运行 agent
    run_agent(adapter, f"最近的 commits: {commits}\n\n"
                       f"可处理的 Issues (ready-for-agent): {issues}\n\n"
                       f"所有 open issues（用于查看阻塞关系）: {all_issues}\n\n"
                       f"{prompt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
