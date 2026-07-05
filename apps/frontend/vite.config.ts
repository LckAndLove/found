import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import appConfig from "../../config/app.config.json";

export default defineConfig({
  base: appConfig.frontend.base,
  plugins: [
    react(),
    {
      name: "app-html-config",
      transformIndexHtml(html) {
        return html.replace(/<title>.*<\/title>/, `<title>${appConfig.app.name}</title>`);
      }
    }
  ],
  server: {
    host: appConfig.frontend.devHost,
    port: appConfig.frontend.devPort,
    proxy: {
      "/api": `http://${appConfig.api.host}:${appConfig.api.port}`
    }
  },
  preview: {
    host: appConfig.frontend.devHost,
    port: appConfig.frontend.previewPort
  }
});
