/// <reference types="vite/client" />

declare global {
  interface Window {
    PERFTRACE_DOWNLOADS?: {
      mac?: string;
      win?: string;
      linux?: string;
    };
  }
}

export {};
