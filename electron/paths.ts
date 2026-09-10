import path from 'node:path';
import { app } from 'electron';

/** Bundled, read-only service definitions (manifest.json + scripts/*.sh per
 * service). In dev this is the repo's `resources/services`; in a packaged
 * app it's `extraResources` copied next to the app bundle's Resources dir.
 * Unlike mac-shortcut-manager's `~/Documents/ShortcutScripts`, this is never
 * a user-editable folder — HackMac ships finished services, it doesn't let
 * people build their own. */
export function servicesDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'services')
    : path.join(app.getAppPath(), 'resources', 'services');
}
