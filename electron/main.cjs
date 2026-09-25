// electron/main.cjs —— Electron 主进程
//
// 关键点：**不用 file:// 加载页面**。
// 这个项目是纯 ES Module + importmap，file:// 协议下模块请求会被当成跨源而拒绝，
// 页面会直接白屏。所以主进程里起一个只监听 127.0.0.1 的静态服务器（server.cjs），
// 窗口再去加载它 —— 既绕开限制，也不暴露到局域网。
//
// 静态服务器单独成模块，是为了能脱离 Electron 直接跑测试
// （见 server.test.mjs）：Electron 的 GUI 在部分非交互式会话里起不来，
// 但"把页面正确地服务出去"这件事必须能独立验证。

const { app, BrowserWindow, Menu, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStaticServer } = require('./server.cjs');

const ROOT = path.join(__dirname, '..'); // 项目根（index.html 所在）

// Windows 上 Electron 是 GUI 子系统程序，主进程的 console.log 不一定能回到父进程的终端，
// 所以启动过程的关键节点同时写一份到临时文件，排查问题时直接看它。
const LOG_FILE = path.join(os.tmpdir(), 'bite-the-moon-electron.log');
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {
    /* 日志写失败不影响主流程 */
  }
  try {
    process.stdout.write(line + '\n');
  } catch {
    /* 没有 stdout 时忽略 */
  }
}

// 自检模式：`electron . --selftest <图片路径>`
// 启动窗口 → 等渲染稳定 → 截屏存盘 → 退出。
// 用来在没有人盯着屏幕的情况下确认窗口里到底渲染出了什么。
const selftestIdx = process.argv.indexOf('--selftest');
const SELFTEST = selftestIdx >= 0;
const SELFTEST_OUT =
  SELFTEST && process.argv[selftestIdx + 1] && !process.argv[selftestIdx + 1].startsWith('--')
    ? process.argv[selftestIdx + 1]
    : path.join(ROOT, 'selftest.png');

let server = null;
let win = null;

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: '文件', submenu: [{ role: 'quit', label: '退出' }] },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载' },
          { role: 'toggleDevTools', label: '开发者工具' },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
        ],
      },
    ])
  );
}

async function createWindow() {
  server = await createStaticServer(ROOT);
  const baseUrl = server.url;
  log('[main] static server ready at', baseUrl);

  win = new BrowserWindow({
    width: 1280,
    height: 920,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#070a1c',
    title: '咬一口月亮 · 月饼配方 × 月相工坊',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', async () => {
    log('[main] ready-to-show');
    win.show();
    if (!SELFTEST) return;
    // 留时间给 3D、贴图与字体稳定下来
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(SELFTEST_OUT, img.toPNG());
      log('[selftest] saved ' + SELFTEST_OUT);
    } catch (err) {
      log('[selftest] failed: ' + (err && err.message));
    }
    app.quit();
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log(`[main] did-fail-load ${code} ${desc} ${url}`);
    if (SELFTEST) app.quit();
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    log('[main] render-process-gone ' + JSON.stringify(details));
  });

  win.loadURL(baseUrl);
  log('[main] loadURL called');

  // 页面里出现的外部链接交给系统浏览器，别把应用窗口带走
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(baseUrl)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

function boot() {
  buildMenu();
  createWindow().catch((err) => {
    log('[main] createWindow failed: ' + (err && err.stack ? err.stack : err));
    app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });
}

log(`[main] start, argv=${JSON.stringify(process.argv.slice(1))}, selftest=${SELFTEST}`);

// 单实例：重复启动就把已有窗口唤到前面。
// 自检模式跳过这层，免得被遗留实例挡在门外而静默退出。
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  log('[main] another instance holds the lock, quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    log('[main] app ready');
    boot();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (server) server.close();
  });
}
