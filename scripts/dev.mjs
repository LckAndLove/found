import { spawn } from "node:child_process";
import appConfig from "../config/app.config.json" with { type: "json" };

const webOnly = process.argv.includes("--web");
const backend = "npm run dev -w @found/backend";
const frontend = "npm run dev -w @found/frontend";
const desktop = `wait-on tcp:${appConfig.api.port} tcp:${appConfig.frontend.devPort} && npm run dev -w @found/desktop`;

const args = [
  "concurrently",
  "-k",
  "-n",
  webOnly ? "backend,frontend" : "backend,frontend,desktop",
  "-c",
  webOnly ? "blue,green" : "blue,green,magenta",
  backend,
  frontend
];

if (!webOnly) {
  args.push(desktop);
}

const child = spawn("npx", args, {
  stdio: "inherit",
  shell: false
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
