export {};

declare global {
  interface Window {
    foundConfig?: {
      apiBaseUrl: string;
      appName?: string;
      appVersion?: string;
    };
  }
}
