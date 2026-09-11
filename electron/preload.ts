import { contextBridge, ipcRenderer } from 'electron';
import type { ActivateResult, PopupRequest, PopupResult, ServiceMeta, ThemePreference, UpdateCheckResult } from '../shared/types';

const api = {
  listServices: (): Promise<ServiceMeta[]> => ipcRenderer.invoke('services:list'),
  activateService: (id: string): Promise<ActivateResult> => ipcRenderer.invoke('services:activate', id),
  deactivateService: (id: string): Promise<void> => ipcRenderer.invoke('services:deactivate', id),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  openLogsFolder: (): Promise<string> => ipcRenderer.invoke('logs:open'),
  checkForUpdates: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('updates:check'),
  getThemePreference: (): Promise<ThemePreference> => ipcRenderer.invoke('theme:get'),
  setThemePreference: (pref: ThemePreference): Promise<void> => ipcRenderer.invoke('theme:set', pref),
  // 실제로 지금 다크를 써야 하는지(라이트/다크/시스템 선택을 nativeTheme이
  // 해석한 결과) — src/main.tsx가 이 값으로 <html data-theme>을 세팅한다.
  getEffectiveDark: (): Promise<boolean> => ipcRenderer.invoke('theme:getEffectiveDark'),
  onThemeChanged: (callback: (isDark: boolean) => void): void => {
    ipcRenderer.on('theme:changed', (_e, isDark: boolean) => callback(isDark));
  },
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
