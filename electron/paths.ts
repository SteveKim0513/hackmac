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

/** 제작 에이전트가 부르는 `hackmac-build`(zsh)와 그 Node 클라이언트 */
export function buildWrapperPath(): string {
  return path.join(binDir(), 'hackmac-build');
}
export function buildClientJsPath(): string {
  return path.join(binDir(), 'hackmac-build-client.cjs');
}
/** 검증 게이트가 시험을 돌릴 때 $HACKMAC_POPUP 자리에 넣는 가짜 팝업 */
export function popupStubPath(): string {
  return path.join(binDir(), 'hackmac-popup-stub');
}

/** 제작 에이전트 지시·능력 목록·참고 문서. 패키지에선 extraResources의 agent/, 개발 중엔 resources/agent + docs/ */
export function agentDocs(): { builder: string; capabilities: string; appleGuide: string; manifestDoc: string | null } {
  if (app.isPackaged) {
    const d = path.join(process.resourcesPath, 'agent');
    return { builder: path.join(d, 'builder.md'), capabilities: path.join(d, 'capabilities.md'), appleGuide: path.join(d, 'apple-app-data-access-guide.md'), manifestDoc: null };
  }
  const root = app.getAppPath();
  return {
    builder: path.join(root, 'resources', 'agent', 'builder.md'),
    capabilities: path.join(root, 'resources', 'agent', 'capabilities.md'),
    appleGuide: path.join(root, 'docs', 'apple-app-data-access-guide.md'),
    manifestDoc: path.join(root, 'docs', 'hackmac-v2-manifest.md'),
  };
}

/** Unix domain socket electron/popupServer.ts listens on. Lives in
 * userData (writable, per-install) rather than next to the read-only
 * bundled resources. */
export function popupSocketPath(): string {
  return path.join(app.getPath('userData'), 'popup.sock');
}
