import { app, BrowserWindow } from "electron";
import { join } from "path";

import icon from "../../resources/icon.png?asset";
import { LivePage } from "./bilibili/live-page.ts";
import { isAllowedPageUrl } from "./bilibili/page-executor.ts";
import { loadWatchEnvironment, prepareWatchResources, migrateWatchResources } from "./config.ts";
import { registerWatchBliveIpc } from "./ipc.ts";

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "Ciel · Watch Blive",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#18181b", symbolColor: "#eaddea", height: 36 },
    backgroundColor: "#18181b",
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  const livePage = new LivePage();
  const disposeIpc = registerWatchBliveIpc(mainWindow, livePage);

  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!isAllowedPageUrl(params.src)) {
      event.preventDefault();
      return;
    }

    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    delete webPreferences.preload;
  });

  mainWindow.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedPageUrl(url)) {
        event.preventDefault();
      }
    });
  });

  let closing = false;
  mainWindow.on("close", (event) => {
    if (closing) return;
    event.preventDefault();
    closing = true;
    void disposeIpc()
      .catch((error) => console.error("关闭观看运行时失败", error))
      .finally(() => {
        livePage.close();
        mainWindow.destroy();
      });
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
loadWatchEnvironment(app.getAppPath());
prepareWatchResources();

app.whenReady().then(async () => {
  await migrateWatchResources();
  // Set app user model id for windows
  app.setAppUserModelId("com.electron");

  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
