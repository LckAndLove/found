import { startApiServer } from "./server.js";

const server = await startApiServer();

console.log(`后端服务已启动：${server.url}`);

