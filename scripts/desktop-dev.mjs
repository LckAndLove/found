import { spawn } from "node:child_process";
import appConfig from "../config/app.config.json" with { type: "json" };

const build = spawn("npm", ["run", "build"], {
  cwd: new URL("../apps/desktop", import.meta.url),
  stdio: "inherit"
});

build.on("exit", (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }

  const electron = spawn("npm", ["exec", "--", "electron", "."], {
    cwd: new URL("../apps/desktop", import.meta.url),
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
