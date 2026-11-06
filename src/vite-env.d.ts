/// <reference types="vite/client" />

import type { HackmacPopupApi, PlaybookApi, StudioApi } from '../electron/preload';

declare global {
  interface Window {
    playbook: PlaybookApi;
    hackmacPopup: HackmacPopupApi;
    studio: StudioApi;
  }
}
