import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("foundConfig", {
  apiBaseUrl: `http://127.0.0.1:${process.env.FOUND_API_PORT ?? 4317}`
});

