import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

import { isAllowedPageUrl } from './bilibili/page-executor.ts';
import { closeBrowseWindow } from './browse-window.ts';
import { prepareWatchResources, migrateWatchResources } from './config.ts';
import { registerWatchBliveIpc } from './ipc.ts';

/** 浏览窗口也计入 getAllWindows()，判断主窗口是否还活着只能靠这个引用。 */
let activeMainWindow: BrowserWindow | undefined;

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Ciel · Watch Blive',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#18181b', symbolColor: '#eaddea', height: 35 },
    backgroundColor: '#18181b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  activeMainWindow = mainWindow;

  // registerWatchBliveIpc 先同步登记 IPC 通道，再异步准备存储与运行时；这里不 await，
  // 让下面的 loadURL 立刻开始加载渲染进程，两边并行。
  const ipc = registerWatchBliveIpc(mainWindow);

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedPageUrl(params.src)) {
      event.preventDefault();
      return;
    }
    mainWindow.webContents.openDevTools();
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    delete webPreferences.preload;
  });

  mainWindow.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedPageUrl(url)) {
        event.preventDefault();
      }
    });
  });

  let closing = false;
  mainWindow.on('close', event => {
    if (closing) return;
    event.preventDefault();
    closing = true;

    void ipc
      .then(dispose => dispose())
      .catch(error => console.error('关闭观看运行时失败', error))
      .finally(() => {
        // 浏览窗口若还开着，window-all-closed 不会触发，应用会变成只剩浏览器的孤儿进程。
        closeBrowseWindow();
        mainWindow.destroy();
      });
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // 开发环境连接热更新服务，打包后使用本地渲染入口。
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // 渲染进程已经在加载，这里只等资源就绪。初始化失败只影响控制面板，
  // 不该把窗口一起挡住，也不该让 createWindow 以未处理拒绝结束。
  await ipc.catch(error => console.error('准备观看运行时失败', error));
}

prepareWatchResources();

app.whenReady().then(async () => {
  await migrateWatchResources();
  app.setAppUserModelId('com.electron');

  await createWindow();

  app.on('activate', () => {
    // macOS 关闭窗口后保留进程，点击 Dock 图标时重新创建窗口。
    if (!activeMainWindow || activeMainWindow.isDestroyed())
      void createWindow().catch(console.error);
  });
});

// macOS 由用户显式退出应用，其他平台关闭最后一个窗口即退出。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
