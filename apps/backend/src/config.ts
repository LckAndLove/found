import appConfigJson from "../../../config/app.config.json" with { type: "json" };

export type AppConfig = {
  app: {
    id: string;
    name: string;
    packageName: string;
    version: string;
    description: string;
    mode: string;
    profileMessage: string;
    userAgent: string;
  };
  api: {
    host: string;
    port: number;
    healthPath: string;
  };
  frontend: {
    devHost: string;
    devPort: number;
    previewPort: number;
    base: string;
  };
  desktop: {
    window: {
      width: number;
      height: number;
      minWidth: number;
      minHeight: number;
      backgroundColor: string;
    };
    releaseDir: string;
    macCategory: string;
    target: string;
  };
  storage: {
    sqlite: {
      relativePath: string;
      busyTimeoutMs: number;
    };
  };
  upstream: {
    timeoutMs: number;
  };
  funds: {
    smartNetValueDefaultMaxDays: number;
    smartNetValueMaxDays: number;
    searchResultLimit: number;
  };
};

export const appConfig = appConfigJson as AppConfig;
