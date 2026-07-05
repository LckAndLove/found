import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { startApiServer } from "../../backend/src/server";

let mainWindow: BrowserWindow | null = null;
let apiServer: Awaited<ReturnType<typeof startApiServer>> | null = null;

function writeLog(message: string, error?: unknown) {
  const line = [
    new Date().toISOString(),
    message,
    error instanceof Error ? `${error.stack ?? error.message}` : ""
  ]
    .filter(Boolean)
    .join(" ");

  console.log(line);

  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(path.join(app.getPath("userData"), "main.log"), `${line}\n`);
  } catch {
    // Logging must never block application startup.
  }
}

function getFrontendEntry() {
  const devUrl = process.env.FOUND_FRONTEND_URL;

  if (devUrl) {
    return devUrl;
  }

  const indexPath = app.isPackaged
    ? path.join(process.resourcesPath, "frontend", "index.html")
    : path.join(__dirname, "..", "..", "frontend", "dist", "index.html");

  return `file://${indexPath}`;
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    title: "3.found",
    backgroundColor: "#eef1ec",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadURL(getFrontendEntry());
}

app.whenReady().then(async () => {
  try {
    writeLog("应用启动");

    apiServer = await startApiServer({
      port: Number(process.env.FOUND_API_PORT ?? 4317)
    });
    writeLog(`后端服务已启动：${apiServer.url}`);

    await createMainWindow();
    writeLog(`前端页面已加载：${getFrontendEntry()}`);

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  } catch (error) {
    writeLog("应用启动失败", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (!apiServer) {
    return;
  }

  event.preventDefault();
  const currentServer = apiServer;
  apiServer = null;
  await currentServer.close();
  app.quit();
});

process.on("uncaughtException", (error) => {
  writeLog("未捕获异常", error);
});

process.on("unhandledRejection", (reason) => {
  writeLog("未处理 Promise 拒绝", reason);
});
