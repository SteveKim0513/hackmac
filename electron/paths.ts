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

/** Same bundling rule as `servicesDir()`, for the popup IPC helper pair a
 * script calls instead of an `osascript` dialog (see docs/design.md). */
function binDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
}

/** The zsh entry point scripts invoke directly (`"$HACKMAC_POPUP" select …`). */
export function popupWrapperPath(): string {
  return path.join(binDir(), 'hackmac-popup');
}

/** The Node client the wrapper execs via `ELECTRON_RUN_AS_NODE=1` — plain
 * JSON over the socket, no shell-level escaping. */
export function popupClientJsPath(): string {
  return path.join(binDir(), 'hackmac-popup-client.cjs');
}

/** Unix domain socket electron/popupServer.ts listens on. Lives in
 * userData (writable, per-install) rather than next to the read-only
 * bundled resources. */
export function popupSocketPath(): string {
  return path.join(app.getPath('userData'), 'popup.sock');
}
