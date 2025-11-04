const { app, globalShortcut } = require('electron');

console.log('========================================');
console.log('🔍 Electron 快捷键诊断工具');
console.log('========================================\n');

app.whenReady().then(() => {
  console.log('✅ Electron 应用已准备就绪\n');

  // 测试1: 简单快捷键
  console.log('测试 1: 注册简单快捷键 Cmd+Shift+F12...');
  const test1 = globalShortcut.register('CommandOrControl+Shift+F12', () => {
    console.log('\n🎉 测试1成功！快捷键回调被触发了！\n');
  });
  console.log(test1 ? '  ✅ 注册成功' : '  ❌ 注册失败');
  console.log(`  验证: ${globalShortcut.isRegistered('CommandOrControl+Shift+F12') ? '✓' : '✗'}\n`);

  // 测试2: 你配置的快捷键
  console.log('测试 2: 注册 Cmd+Shift+9...');
  const test2 = globalShortcut.register('CommandOrControl+Shift+9', () => {
    console.log('\n🎉 测试2成功！Cmd+Shift+9 回调被触发了！\n');
  });
  console.log(test2 ? '  ✅ 注册成功' : '  ❌ 注册失败');
  console.log(`  验证: ${globalShortcut.isRegistered('CommandOrControl+Shift+9') ? '✓' : '✗'}\n`);

  // 测试3: 简单字母快捷键
  console.log('测试 3: 注册 Cmd+Shift+T...');
  const test3 = globalShortcut.register('CommandOrControl+Shift+T', () => {
    console.log('\n🎉 测试3成功！Cmd+Shift+T 回调被触发了！\n');
  });
  console.log(test3 ? '  ✅ 注册成功' : '  ❌ 注册失败');
  console.log(`  验证: ${globalShortcut.isRegistered('CommandOrControl+Shift+T') ? '✓' : '✗'}\n`);

  console.log('========================================');
  console.log('📌 请尝试按以下快捷键：');
  console.log('   1. Cmd+Shift+F12');
  console.log('   2. Cmd+Shift+9');
  console.log('   3. Cmd+Shift+T');
  console.log('========================================');
  console.log('💡 观察终端是否有 "🎉" 输出');
  console.log('💡 按 Ctrl+C 退出测试\n');
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

