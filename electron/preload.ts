import { contextBridge, ipcRenderer } from 'electron';
import type { ActivateResult, PopupRequest, PopupResult, ServiceMeta, UpdateCheckResult } from '../shared/types';

const api = {
  listServices: (): Promise<ServiceMeta[]> => ipcRenderer.invoke('services:list'),
  activateService: (id: string): Promise<ActivateResult> => ipcRenderer.invoke('services:activate', id),
  deactivateService: (id: string): Promise<void> => ipcRenderer.invoke('services:deactivate', id),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  openLogsFolder: (): Promise<string> => ipcRenderer.invoke('logs:open'),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),
};

export type PlaybookApi = typeof api;

contextBridge.exposeInMainWorld('playbook', api);

// electron/popupWindow.ts가 띄우는 별도 팝업 창(src/popup/PopupApp.tsx)에서만
// 쓰는 최소 브리지 — 메인 창의 `playbook`과 성격이 달라 이름을 분리했다.
const popupApi = {
  ready: (): void => ipcRenderer.send('popup:ready'),
  onInit: (callback: (req: PopupRequest) => void): void => {
    ipcRenderer.on('popup:init', (_e, req: PopupRequest) => callback(req));
  },
  resolve: (result: PopupResult): void => ipcRenderer.send('popup:resolve', result),
};

export type HackmacPopupApi = typeof popupApi;

contextBridge.exposeInMainWorld('hackmacPopup', popupApi);
