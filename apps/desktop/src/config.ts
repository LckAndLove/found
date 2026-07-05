import appConfigJson from "../../../config/app.config.json";

export const appConfig = appConfigJson as {
  app: {
    name: string;
    version: string;
  };
  api: {
    host: string;
    port: number;
  };
  frontend: {
    devPort: number;
  };
  desktop: {
    window: {
      width: number;
      height: number;
      minWidth: number;
      minHeight: number;
      backgroundColor: string;
    };
  };
  storage: {
    sqlite: {
      relativePath: string;
    };
  };
};
