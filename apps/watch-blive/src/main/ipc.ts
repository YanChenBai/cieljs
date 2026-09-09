import { join } from 'node:path';

import { DevtoolsHost, devtoolsStorage } from '@cieljs/devtools/host';
import { createMcp } from '@cieljs/mcp';
import { memoryStorage } from '@cieljs/memory';
import { sessionStorage } from '@cieljs/session';
import { Storage } from '@cieljs/storage';
import { vectorStorage } from '@cieljs/vector';
import { RPCHandler } from '@orpc/server/message-port';
import { ipcMain, type BrowserWindow, type IpcMainEvent, type MessagePortMain } from 'electron';

import type { LivePage } from './bilibili/live-page.ts';
import { watchDataDirectory } from './config.ts';
import { createWatchRouter } from './router.ts';

export const WATCH_RPC_CHANNEL = 'watch-blive:rpc';

export async function registerWatchBliveIpc(mainWindow: BrowserWindow, livePage: LivePage) {
  await using resources = new AsyncDisposableStack();
  const storage = resources.use(
    await Storage.open({
      dataDir: join(watchDataDirectory(), 'storage'),
      modules: [sessionStorage, memoryStorage, vectorStorage, devtoolsStorage],
    }),
  );
  const devtools = resources.use(await DevtoolsHost.open({ storage }));
  const mcp = resources.use(
    await createMcp({ configFile: join(watchDataDirectory(), 'mcp.json') }),
  );
  const runtime = createWatchRouter(mainWindow, livePage, devtools, mcp);
  const handler = new RPCHandler(runtime.router);
  const ports = new Set<MessagePortMain>();
  // 仅主窗口的主 frame 可建立连接，直播 guest 不能访问控制路由。
  const connect = (event: IpcMainEvent) => {
    const trusted =
      !mainWindow.isDestroyed() &&
      event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame &&
      event.senderFrame.url === mainWindow.webContents.getURL();
    if (!trusted || event.ports.length !== 1) {
      for (const port of event.ports) port.close();
      return;
    }
    const port = event.ports[0]!;
    ports.add(port);
    port.on('close', () => {
      ports.delete(port);
    });
    handler.upgrade(port);
    port.start();
  };
  const release = () => {
    for (const port of ports) {
      void handler.close(port);
      port.close();
    }
    ports.clear();
  };
  ipcMain.on(WATCH_RPC_CHANNEL, connect);
  const navigation = (_event: unknown, _url: string, _inPlace: boolean, isMainFrame: boolean) => {
    if (isMainFrame) release();
  };
  mainWindow.webContents.on('did-start-navigation', navigation);
  const lifetime = resources.move();
  return async () => {
    ipcMain.removeListener(WATCH_RPC_CHANNEL, connect);
    mainWindow.webContents.removeListener('did-start-navigation', navigation);
    release();
    try {
      await runtime.close();
    } finally {
      await lifetime.disposeAsync();
    }
  };
}
