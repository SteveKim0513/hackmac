import { contextBridge, ipcRenderer } from 'electron';
import type { BundlePick, MaintenanceView } from '../shared/studio';
import type { ActivateResult, PopupRequest, PopupResult, ServiceMeta, ThemePreference, UpdateCheckResult } from '../shared/types';
import type { AccountsView, RecipeView, BuildState, ChatEvent, InstallView, LoginView, SendResult, ThreadMeta, ThreadView, Vendor } from '../shared/studio';

const api = {
  listServices: (): Promise<ServiceMeta[]> => ipcRenderer.invoke('services:list'),
  /** 앱 상세의 유지보수: 대기 중인 수정본·기록·자동 적용 */
  maintenance: (appId: string): Promise<MaintenanceView> => ipcRenderer.invoke('maintenance:get', appId),
  applyFix: (fixId: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> => ipcRenderer.invoke('maintenance:apply', fixId),
  dismissFix: (fixId: string): Promise<boolean> => ipcRenderer.invoke('maintenance:dismiss', fixId),
  setAutoApply: (on: boolean): Promise<boolean> => ipcRenderer.invoke('maintenance:setAuto', on),
  pickBundle: (): Promise<BundlePick> => ipcRenderer.invoke('bundle:pick'),
  installBundle: (file: string): Promise<{ ok: true; id: string } | { ok: false; errors: string[] }> => ipcRenderer.invoke('bundle:install', file),
  exportApp: (appId: string): Promise<{ exported: true; file: string } | { exported: false; error?: string }> => ipcRenderer.invoke('bundle:export', appId),
  revealFile: (file: string): Promise<void> => ipcRenderer.invoke('bundle:reveal', file),
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

// 작업실(계정·스레드·채팅). electron/studioHost.ts의 IPC와 짝이다.
const studioApi = {
  accounts: (refresh = false): Promise<AccountsView> => ipcRenderer.invoke('accounts:get', refresh),
  chooseEngine: (v: Vendor): Promise<AccountsView> => ipcRenderer.invoke('accounts:choose', v),
  onAccountsChanged: (cb: (a: AccountsView) => void): (() => void) => {
    const h = (_e: unknown, a: AccountsView) => cb(a);
    ipcRenderer.on('accounts:changed', h);
    return () => ipcRenderer.removeListener('accounts:changed', h);
  },
  installStart: (v: Vendor): Promise<InstallView> => ipcRenderer.invoke('install:start', v),
  installState: (v: Vendor): Promise<InstallView | null> => ipcRenderer.invoke('install:state', v),
  addAccount: (v: Vendor, label?: string): Promise<{ ok: true; id: string; view: AccountsView } | { ok: false; error: string }> => ipcRenderer.invoke('accounts:add', v, label),
  setActiveAccount: (id: string): Promise<{ ok: true; view: AccountsView } | { ok: false; error: string }> => ipcRenderer.invoke('accounts:setActive', id),
  renameAccount: (id: string, label: string): Promise<{ ok: true; view: AccountsView } | { ok: false; error: string }> => ipcRenderer.invoke('accounts:rename', id, label),
  removeAccount: (id: string): Promise<{ ok: true; view: AccountsView } | { ok: false; error: string }> => ipcRenderer.invoke('accounts:remove', id),
  setThreadAccount: (threadId: string, accountId: string): Promise<SendResult> => ipcRenderer.invoke('thread:setAccount', threadId, accountId),
  /** id는 계정 id(기본 계정은 'claude-default' 등) */
  loginStart: (id: string): Promise<LoginView> => ipcRenderer.invoke('login:start', id),
  loginState: (id: string): Promise<LoginView | null> => ipcRenderer.invoke('login:state', id),
  loginSubmit: (id: string, code: string): Promise<LoginView | null> => ipcRenderer.invoke('login:submit', id, code),
  loginCancel: (id: string): Promise<void> => ipcRenderer.invoke('login:cancel', id),
  openUrl: (url: string): Promise<void> => ipcRenderer.invoke('login:openUrl', url),
  threads: (): Promise<ThreadView[]> => ipcRenderer.invoke('threads:list'),
  createThread: (title: string): Promise<ThreadMeta> => ipcRenderer.invoke('threads:create', title),
  thread: (id: string): Promise<ThreadView | null> => ipcRenderer.invoke('threads:get', id),
  send: (id: string, text: string): Promise<SendResult> => ipcRenderer.invoke('chat:send', id, text),
  interrupt: (id: string): Promise<void> => ipcRenderer.invoke('chat:interrupt', id),
  makeRecipe: (threadId: string): Promise<RecipeView> => ipcRenderer.invoke('recipe:make', threadId),
  build: (id: string): Promise<BuildState | null> => ipcRenderer.invoke('build:get', id),
  onBuild: (cb: (threadId: string, s: BuildState) => void): (() => void) => {
    const h = (_e: unknown, p: { threadId: string; state: BuildState }) => cb(p.threadId, p.state);
    ipcRenderer.on('build:state', h);
    return () => ipcRenderer.removeListener('build:state', h);
  },
  /** 제작이 앱을 보관소에 넣었다 → 홈의 "내 앱"을 다시 읽는다 */
  onServicesChanged: (cb: () => void): (() => void) => {
    const h = () => cb();
    ipcRenderer.on('services:changed', h);
    return () => ipcRenderer.removeListener('services:changed', h);
  },
  onChat: (cb: (threadId: string, e: ChatEvent) => void): (() => void) => {
    const h = (_e: unknown, p: { threadId: string; event: ChatEvent }) => cb(p.threadId, p.event);
    ipcRenderer.on('chat:event', h);
    return () => ipcRenderer.removeListener('chat:event', h);
  },
};

export type StudioApi = typeof studioApi;

contextBridge.exposeInMainWorld('studio', studioApi);

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
