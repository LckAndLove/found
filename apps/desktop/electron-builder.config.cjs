const appConfig = require("../../config/app.config.json");

const versionedProductName = `${appConfig.app.name}-${appConfig.app.version}`;

module.exports = {
  appId: appConfig.app.id,
  productName: versionedProductName,
  electronVersion: appConfig.versions.electron,
  extraMetadata: {
    name: appConfig.app.packageName,
    version: appConfig.app.version,
    description: appConfig.app.description
  },
  directories: {
    output: appConfig.desktop.releaseDir
  },
  files: ["dist/**/*", "assets/**/*", "package.json"],
  extraResources: [
    {
      from: "../frontend/dist",
      to: "frontend"
    }
  ],
  mac: {
    category: appConfig.desktop.macCategory,
    icon: "assets/icon.icns",
    target: [appConfig.desktop.target]
  },
  win: {
    icon: "assets/icon.ico",
    target: ["dir"]
  }
};
