const appConfig = require("../../config/app.config.json");

module.exports = {
  appId: appConfig.app.id,
  productName: appConfig.app.name,
  electronVersion: appConfig.versions.electron,
  directories: {
    output: appConfig.desktop.releaseDir
  },
  files: ["dist/**/*", "package.json"],
  extraResources: [
    {
      from: "../frontend/dist",
      to: "frontend"
    }
  ],
  mac: {
    category: appConfig.desktop.macCategory,
    target: [appConfig.desktop.target]
  }
};
