import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import { createRequire } from "node:module";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const requireFromElectron = createRequire(import.meta.url);

const APP_NAME = "MUXEL";
const SERVER_READY_TIMEOUT_MS = 30000;
const SERVER_POLL_INTERVAL_MS = 120;

let mainWindow = null;
let appUrl = null;

function createAppMenu() {
  return Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ]);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;

      probe.close(() => {
        if (!port) {
          reject(new Error("Unable to allocate a local port for MUXEL."));
          return;
        }

        resolve(port);
      });
    });
  });
}

async function getServerPort() {
  const configuredPort = Number.parseInt(process.env.MUXEL_PORT || "", 10);

  if (
    Number.isInteger(configuredPort) &&
    configuredPort >= 1024 &&
    configuredPort <= 65535
  ) {
    return configuredPort;
  }

  return getFreePort();
}

function requestServer(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode && response.statusCode < 500);
    });

    request.on("error", () => resolve(false));
    request.setTimeout(2000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_READY_TIMEOUT_MS) {
    if (await requestServer(url)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL_MS));
  }

  throw new Error(`MUXEL did not finish starting within ${SERVER_READY_TIMEOUT_MS / 1000}s.`);
}

async function startBundledNextServer() {
  const port = await getServerPort();
  const serverRoot = path.join(process.resourcesPath, "next-server");
  const serverEntry = path.join(serverRoot, "server.js");
  const url = `http://127.0.0.1:${port}`;

  process.env.NODE_ENV = "production";
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  process.env.PORT = String(port);
  process.env.HOSTNAME = "127.0.0.1";

  requireFromElectron(serverEntry);
  await waitForServer(url);

  return url;
}

async function resolveAppUrl() {
  if (!app.isPackaged) {
    return process.env.ELECTRON_START_URL || "http://127.0.0.1:3000";
  }

  return startBundledNextServer();
}

function isInternalUrl(targetUrl) {
  if (!appUrl) {
    return false;
  }

  try {
    const target = new URL(targetUrl);
    const appOrigin = new URL(appUrl).origin;
    return target.origin === appOrigin;
  } catch {
    return false;
  }
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#0d0d0d",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isInternalUrl(targetUrl)) {
      return { action: "allow" };
    }

    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (isInternalUrl(targetUrl)) {
      return;
    }

    event.preventDefault();
    shell.openExternal(targetUrl);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(url);
}

const singleInstanceLock = app.requestSingleInstanceLock();
app.setName(APP_NAME);

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(createAppMenu());

    try {
      appUrl = await resolveAppUrl();
      await createWindow(appUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(APP_NAME, `MUXEL could not start.\n\n${message}`);
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appUrl) {
      createWindow(appUrl);
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
