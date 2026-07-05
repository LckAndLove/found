import { spawn } from "node:child_process";
import { copyFileSync, existsSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import appConfig from "../config/app.config.json" with { type: "json" };

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const desktopRoot = join(repoRoot, "apps", "desktop");
const electronAppContents = join(repoRoot, "node_modules", "electron", "dist", "Electron.app", "Contents");

function run(command, args) {
  const result = spawn(command, args, { stdio: "inherit" });
  return new Promise((resolve, reject) => {
    result.on("error", reject);
    result.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? 1}`));
    });
  });
}

function setPlistValue(plistPath, key, value) {
  return run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plistPath]).catch(() =>
    run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plistPath])
  );
}

async function syncDevElectronBranding() {
  const plistPath = join(electronAppContents, "Info.plist");
  const resourcesDir = join(electronAppContents, "Resources");
  const iconPath = join(desktopRoot, "assets", "icon.icns");
  const electronAppPath = dirname(electronAppContents);

  if (!existsSync(plistPath) || !existsSync(iconPath)) {
    return;
  }

  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  await setPlistValue(plistPath, "CFBundleName", appConfig.app.name);
  await setPlistValue(plistPath, "CFBundleDisplayName", appConfig.app.name);
  await setPlistValue(plistPath, "CFBundleIdentifier", appConfig.app.id);
  await setPlistValue(plistPath, "CFBundleIconFile", "icon.icns");
  const now = new Date();
  utimesSync(electronAppPath, now, now);
}

const build = spawn("npm", ["run", "build"], {
  cwd: desktopRoot,
  stdio: "inherit"
});

build.on("exit", async (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  try {
    await syncDevElectronBranding();
  } catch (error) {
    console.warn("同步开发模式应用名称和图标失败，将继续启动 Electron：", error);
  }

  const electron = spawn("npm", ["exec", "--", "electron", "."], {
    cwd: desktopRoot,
    env: {
      ...process.env,
      FOUND_FRONTEND_URL: `http://${appConfig.frontend.devHost}:${appConfig.frontend.devPort}`
    },
    stdio: "inherit"
  });

  electron.on("exit", (electronCode) => {
    process.exit(electronCode ?? 0);
  });
});
