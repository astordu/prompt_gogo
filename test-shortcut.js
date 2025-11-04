const { app, globalShortcut, Notification } = require('electron');

console.log('=== 快捷键权限测试工具 ===\n');

app.whenReady().then(() => {
  console.log('应用已启动');
  console.log('平台:', process.platform);
  console.log('Electron 版本:', process.versions.electron);
  console.log('');

  // Test 1: 注册一个简单的快捷键
  console.log('测试 1: 注册 CommandOrControl+Shift+F12...');
  const success = globalShortcut.register('CommandOrControl+Shift+F12', () => {
    console.log('\n✅✅✅ 快捷键被触发了！权限正常！✅✅✅\n');
    new Notification({
      title: '成功！',
      body: '快捷键工作正常！说明权限已给予。'
    }).show();
  });

  if (success) {
    console.log('✅ 注册返回 success=true');
    console.log('✅ 验证:', globalShortcut.isRegistered('CommandOrControl+Shift+F12') ? '已注册' : '未注册');
    console.log('');
    console.log('⚠️  关键测试：请按 Cmd+Shift+F12');
    console.log('');
    console.log('如果看到 "快捷键被触发了" 消息 → 权限正常');
    console.log('如果没有任何反应 → 缺少辅助功能权限\n');
    console.log('等待你按快捷键... (按 Ctrl+C 退出)');
  } else {
    console.log('❌ 注册返回 success=false');
    console.log('这个快捷键可能被占用\n');
  }

  // 保持应用运行
  setInterval(() => {}, 1000);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
