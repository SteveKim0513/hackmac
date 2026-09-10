import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface AppSettings {
  /** Service ids the user has turned on — restored on next launch so
   * hotkeys keep working without the app needing to stay in the foreground. */
  activeServiceIds: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeServiceIds: [],
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(next: AppSettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}
