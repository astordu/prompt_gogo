#!/bin/bash
set -eo pipefail

usage() {
  echo "Usage: $0 <qodercli|claude> [max_iterations]" >&2
}

ADAPTER=${1:-}
MAX_ITERATIONS=${2:-10}

case "$ADAPTER" in
  qodercli|claude)
    ;;
  *)
    usage
    exit 1
    ;;
esac

if ! [[ "$MAX_ITERATIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "max_iterations 必须是正整数。" >&2
  usage
  exit 1
fi

run_agent() {
  local agent_prompt=$1

  case "$ADAPTER" in
    qodercli)
      qodercli --model Qwen3.8-Max-Preview --permission-mode bypassPermissions -p "$agent_prompt"
      ;;
    claude)
      claude --dangerously-skip-permissions -p "$agent_prompt"
      ;;
  esac
}

for ((i=1; i<=MAX_ITERATIONS; i++)); do
  echo "=== Ralph iteration $i/$MAX_ITERATIONS ($ADAPTER) ==="

  # 获取最近 commits 作为上下文
  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")

  # 从 GitHub 拉取所有 open issues（含正文和评论）
  # 优先拉取 ready-for-agent 标签的 issues
  issues=$(gh issue list --state open --label "ready-for-agent" --json number,title,body,labels,comments --limit 50 2>/dev/null || echo "[]")

  # 同时拉取其他 open issues（用于了解阻塞关系和全局状态）
  all_issues=$(gh issue list --state open --json number,title,labels --limit 50 2>/dev/null || echo "[]")

  # 加载 prompt
  prompt=$(cat ralph/prompt.md)

  # 运行 agent
  result=$(run_agent "最近的 commits: $commits

可处理的 Issues (ready-for-agent): $issues

所有 open issues（用于查看阻塞关系）: $all_issues

$prompt")

  echo "$result"

  # 检查是否所有任务都已完成
  if [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]]; then
    echo "Ralph complete after $i iterations."
    exit 0
  fi
done

echo "Ralph 停止，已完成 $MAX_ITERATIONS 次迭代（达到上限）。"
