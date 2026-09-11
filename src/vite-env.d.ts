/// <reference types="vite/client" />

import type { HackmacPopupApi, PlaybookApi } from '../electron/preload';

declare global {
  interface Window {
    playbook: PlaybookApi;
    hackmacPopup: HackmacPopupApi;
  }
}
