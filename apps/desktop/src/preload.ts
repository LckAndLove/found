import { contextBridge } from "electron";
import { appConfig } from "./config";

contextBridge.exposeInMainWorld("foundConfig", {
  apiBaseUrl: `http://${appConfig.api.host}:${process.env.FOUND_API_PORT ?? appConfig.api.port}`,
  appName: appConfig.app.name,
  appVersion: appConfig.app.version
});
