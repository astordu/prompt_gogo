#!/bin/bash

echo "=== Prompt Go 权限诊断工具 ==="
echo ""

# Test 1: AppleScript 基本测试
echo "测试 1: 测试 AppleScript 是否可以运行..."
osascript -e 'display notification "测试通知" with title "权限测试"' 2>&1
if [ $? -eq 0 ]; then
    echo "✅ AppleScript 基本功能正常"
else
    echo "❌ AppleScript 执行失败"
fi
echo ""

# Test 2: 测试模拟按键（需要辅助功能权限）
echo "测试 2: 测试模拟按键（需要辅助功能权限）..."
echo "请在 5 秒内选中一些文本..."
sleep 5
osascript -e 'tell application "System Events" to keystroke "c" using command down' 2>&1
if [ $? -eq 0 ]; then
    echo "✅ 模拟按键命令执行成功（检查是否真的复制了文本）"
else
    echo "❌ 模拟按键失败 - 可能缺少辅助功能权限"
fi
echo ""

# Test 3: 检查剪贴板
echo "测试 3: 读取剪贴板..."
pbpaste | head -c 100
echo ""
echo ""

echo "=== 诊断建议 ==="
echo "如果测试 2 失败，请检查："
echo "1. 系统设置 > 隐私与安全性 > 辅助功能 > 确保 'Terminal' 或 'iTerm' 已开启"
echo "2. 如果在 Electron 应用中运行，确保应用本身也在列表中并已开启"
echo ""
