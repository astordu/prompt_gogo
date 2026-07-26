#!/bin/bash
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TEST_TMP=$(mktemp -d)
FAKE_BIN="$TEST_TMP/bin"
AGENT_CALLS_FILE="$TEST_TMP/agent-calls"
GH_READY_CALLS_FILE="$TEST_TMP/gh-ready-calls"

cleanup() {
  rm -rf "$TEST_TMP"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN"
echo 0 > "$AGENT_CALLS_FILE"
echo 0 > "$GH_READY_CALLS_FILE"

cat > "$FAKE_BIN/git" <<'EOF'
#!/bin/bash
echo "fake commit"
EOF

cat > "$FAKE_BIN/qodercli" <<'EOF'
#!/bin/bash
calls=$(<"$AGENT_CALLS_FILE")
echo $((calls + 1)) > "$AGENT_CALLS_FILE"
echo "<promise>NO MORE TASKS</promise>"
EOF

cat > "$FAKE_BIN/gh" <<'EOF'
#!/bin/bash
if [[ "$*" != *"--label ready-for-agent"* ]]; then
  echo "[]"
  exit 0
fi

case "$GH_MODE" in
  empty)
    echo "[]"
    ;;
  always-ready)
    echo '[{"number":1,"title":"Task","body":"","labels":[],"comments":[]}]'
    ;;
  ready-then-empty)
    calls=$(<"$GH_READY_CALLS_FILE")
    echo $((calls + 1)) > "$GH_READY_CALLS_FILE"
    if ((calls == 0)); then
      echo '[{"number":1,"title":"Task","body":"","labels":[],"comments":[]}]'
    else
      echo "[]"
    fi
    ;;
  error)
    echo "GitHub unavailable" >&2
    exit 1
    ;;
esac
EOF

chmod +x "$FAKE_BIN/git" "$FAKE_BIN/qodercli" "$FAKE_BIN/gh"

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

assert_contains() {
  local actual=$1
  local expected=$2
  local message=$3
  [[ "$actual" == *"$expected"* ]] || fail "$message"
}

run_afk() {
  local mode=$1
  local max_iterations=$2
  GH_MODE=$mode \
    AGENT_CALLS_FILE=$AGENT_CALLS_FILE \
    GH_READY_CALLS_FILE=$GH_READY_CALLS_FILE \
    PATH="$FAKE_BIN:$PATH" \
    bash "$REPO_ROOT/ralph/afk.sh" qodercli "$max_iterations" 2>&1
}

test_model_promise_does_not_override_ready_issues() {
  echo 0 > "$AGENT_CALLS_FILE"

  local output
  output=$(run_afk always-ready 2)

  assert_contains "$output" "达到上限" "仍有 ready-for-agent issue 时应达到迭代上限"
  [[ "$(<"$AGENT_CALLS_FILE")" == 2 ]] ||
    fail "模型的 NO MORE TASKS promise 不应提前停止循环"
}

test_empty_tracker_completes_without_agent() {
  echo 0 > "$AGENT_CALLS_FILE"

  local output
  output=$(run_afk empty 2)

  assert_contains "$output" "Ralph complete after 0 iterations." \
    "没有 ready-for-agent issue 时应立即完成"
  [[ "$(<"$AGENT_CALLS_FILE")" == 0 ]] ||
    fail "没有 ready-for-agent issue 时不应调用 Agent"
}

test_tracker_failure_is_not_treated_as_completion() {
  echo 0 > "$AGENT_CALLS_FILE"

  local output
  local status
  output=$(run_afk error 2)
  status=$?

  [[ "$status" == 1 ]] || fail "tracker 查询失败时应返回非零退出码"
  assert_contains "$output" "无法读取 ready-for-agent issues" \
    "tracker 查询失败时应报告真实原因"
  [[ "$(<"$AGENT_CALLS_FILE")" == 0 ]] ||
    fail "tracker 查询失败时不应调用 Agent"
}

test_final_iteration_refreshes_tracker_state() {
  echo 0 > "$AGENT_CALLS_FILE"
  echo 0 > "$GH_READY_CALLS_FILE"

  local output
  output=$(run_afk ready-then-empty 1)

  assert_contains "$output" "Ralph complete after 1 iterations." \
    "最后一轮完成任务后应刷新 tracker 并报告完成"
  [[ "$output" != *"达到上限"* ]] ||
    fail "最后一轮已清空 tracker 时不应报告达到上限"
}

test_model_promise_does_not_override_ready_issues
echo "PASS: model promise does not override tracker state"
test_empty_tracker_completes_without_agent
echo "PASS: empty tracker completes without agent"
test_tracker_failure_is_not_treated_as_completion
echo "PASS: tracker failure is not treated as completion"
test_final_iteration_refreshes_tracker_state
echo "PASS: final iteration refreshes tracker state"
