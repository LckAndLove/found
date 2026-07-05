export {};

declare global {
  interface Window {
    foundConfig?: {
      apiBaseUrl: string;
    };
  }
}

