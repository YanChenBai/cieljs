import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

import { LivePage } from './bilibili/live-page.ts';
import { isAllowedPageUrl } from './bilibili/page-executor.ts';
import { prepareWatchResources, migrateWatchResources } from './config.ts';
import { registerWatchBliveIpc } from './ipc.ts';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Ciel · Watch Blive',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#18181b', symbolColor: '#eaddea', height: 36 },
    backgroundColor: '#18181b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  const livePage = new LivePage();
  const disposeIpc = registerWatchBliveIpc(mainWindow, livePage);

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedPageUrl(params.src)) {
      event.preventDefault();
      return;
    }

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

    void disposeIpc()
      .catch(error => console.error('关闭观看运行时失败', error))
      .finally(() => {
        livePage.close();
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
}

prepareWatchResources();

app.whenReady().then(async () => {
  await migrateWatchResources();
  app.setAppUserModelId('com.electron');

  createWindow();

  app.on('activate', () => {
    // macOS 关闭窗口后保留进程，点击 Dock 图标时重新创建窗口。
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// macOS 由用户显式退出应用，其他平台关闭最后一个窗口即退出。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
