import cors from "cors";
import express from "express";
import type { Server } from "node:http";

export type ApiServerOptions = {
  port?: number;
  host?: string;
};

export function createApiApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      name: "3.found",
      service: "backend",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/profile", (_request, response) => {
    response.json({
      appName: "3.found",
      mode: "personal",
      message: "前后端和桌面端链路已连通"
    });
  });

  return app;
}

export async function startApiServer(options: ApiServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 4317);
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const app = createApiApp();

  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(port, host, () => resolve(instance));
    instance.on("error", reject);
  });

  return {
    app,
    server,
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  };
}

