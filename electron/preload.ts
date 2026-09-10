import { contextBridge, ipcRenderer } from 'electron';
import type { ActivateResult, ServiceMeta } from '../shared/types';

const api = {
  listServices: (): Promise<ServiceMeta[]> => ipcRenderer.invoke('services:list'),
  activateService: (id: string): Promise<ActivateResult> => ipcRenderer.invoke('services:activate', id),
  deactivateService: (id: string): Promise<void> => ipcRenderer.invoke('services:deactivate', id),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  openLogsFolder: (): Promise<string> => ipcRenderer.invoke('logs:open'),
};

export type PlaybookApi = typeof api;

contextBridge.exposeInMainWorld('playbook', api);
