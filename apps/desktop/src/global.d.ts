import type { DesktopBridge } from '../electron/preload.js';

declare global {
  interface Window {
    desktopApi: DesktopBridge;
  }
}

export {};
