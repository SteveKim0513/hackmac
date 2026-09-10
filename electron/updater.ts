import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Auto-update via GitHub Releases (github.com/SteveKim0513/hackmac, public —
 * update checks need no token; publishing does, via GH_TOKEN at `dist` time).
 * Same shape as mind-map-mac's electron/updater.ts.
 *
 * Background checks fail silently into the console; the user only hears about
 * an update once it's fully downloaded, via a native "지금 재시동 / 나중에"
 * dialog. "나중에" still applies automatically on the next quit.
 */

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

async function promptRestart(version: string) {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `새 버전 v${version}이 준비되었어요`,
    detail: '지금 재시동하면 바로 적용돼요. 나중에 해도 다음에 앱을 종료할 때 자동으로 적용돼요.',
    buttons: ['지금 재시동', '나중에'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    autoUpdater.quitAndInstall();
  }
}

/** Updates run only in packaged builds — `npm run dev`'s Electron.app has no
 * real releases to check against and would just log noise every 4 hours. */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // "나중에" still applies on quit

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] 다운로드 완료:', info.version);
    void promptRestart(info.version);
  });
  autoUpdater.on('error', (err) => {
    // Background failures must never interrupt the user — log and retry on
    // the next interval.
    console.error('[updater] 확인 실패:', err?.message ?? err);
  });

  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), FIRST_CHECK_DELAY_MS);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
}
