/// <reference types="vite/client" />

declare module "*.css";

/// <reference types="preline/global" />

declare global {
  interface Window {
    HSStaticMethods?: {
      autoInit: (collection?: string[]) => void
    }
  }
}

export {}
