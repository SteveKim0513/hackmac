import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateCheckResult } from '../shared/types';

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

const MANUAL_CHECK_TIMEOUT_MS = 15_000;

/** "업데이트 확인" 버튼 — 백그라운드 체크와 같은 `autoUpdater` 이벤트 스트림을
 * 쓰므로, 이번 수동 확인에 대한 결과만 한 번 받고 리스너를 정리한다. */
export function checkForUpdatesManually(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) return Promise.resolve({ status: 'disabled' });

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: UpdateCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
      resolve(result);
    };
    const onAvailable = (info: { version: string }) => settle({ status: 'downloading', version: info.version });
    const onNotAvailable = () => settle({ status: 'up-to-date' });
    const onError = (err: Error) => settle({ status: 'error', message: err?.message ?? String(err) });
    const timer = setTimeout(() => settle({ status: 'error', message: '응답이 없어요' }), MANUAL_CHECK_TIMEOUT_MS);

    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
    autoUpdater.checkForUpdates().catch((err) => settle({ status: 'error', message: String(err?.message ?? err) }));
  });
}
