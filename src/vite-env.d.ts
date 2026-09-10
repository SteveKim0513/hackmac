/// <reference types="vite/client" />

import type { PlaybookApi } from '../electron/preload';

declare global {
  interface Window {
    playbook: PlaybookApi;
  }
}
