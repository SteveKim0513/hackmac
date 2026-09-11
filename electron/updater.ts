import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateCheckResult } from '../shared/types';

/**
 * Auto-update via GitHub Releases (github.com/SteveKim0513/hackmac, public —
 * update checks need no token; publishing does, via GH_TOKEN at `dist` time).
 * Same shape as mind-map-mac's electron/updater.ts.
 *
 * The user only hears about an update once it's fully downloaded, via a
 * native "지금 재시동 / 나중에" dialog. "나중에" still applies automatically
 * on the next quit.
 */

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// A packaged app launched from Finder has no terminal attached, so plain
// console.log/console.error go nowhere — nothing captures them, not even
// Console.app (confirmed by checking `log show` for this process: zero
// output despite the code definitely running). Writing to a real file is
// the only way a background check's outcome is ever inspectable after the
// fact. electron-updater's own internal logging (`this._logger`) goes
// through this too, via `autoUpdater.logger` below — that's normally the
// most useful half of it (its default logger is also just `console`).
function updaterLogPath(): string {
  return path.join(app.getPath('logs'), 'updater.log');
}

function writeLog(level: string, message: string) {
  try {
    fs.mkdirSync(path.dirname(updaterLogPath()), { recursive: true });
    fs.appendFileSync(updaterLogPath(), `[${new Date().toISOString()}] [${level}] ${message}\n`);
  } catch {
    // best-effort only — a broken log write must never take down the updater
  }
}

const fileLogger = {
  info: (message?: unknown) => writeLog('info', String(message)),
  warn: (message?: unknown) => writeLog('warn', String(message)),
  error: (message?: unknown) => writeLog('error', String(message)),
  debug: (message?: unknown) => writeLog('debug', String(message)),
};

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

  autoUpdater.logger = fileLogger;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // "나중에" still applies on quit

  autoUpdater.on('checking-for-update', () => fileLogger.info('배경 체크 시작'));
  autoUpdater.on('update-not-available', () => fileLogger.info('배경 체크 결과: 최신 버전'));
  autoUpdater.on('update-downloaded', (info) => {
    fileLogger.info(`다운로드 완료: v${info.version}`);
    void promptRestart(info.version);
  });
  autoUpdater.on('error', (err) => {
    // Background failures must never interrupt the user — log and retry on
    // the next interval.
    fileLogger.error(`배경 체크 실패: ${err?.message ?? err}`);
  });

  fileLogger.info(`자동 업데이트 시작 — 현재 버전 v${app.getVersion()}, ${FIRST_CHECK_DELAY_MS / 1000}초 후 첫 확인, 이후 ${CHECK_INTERVAL_MS / 3600_000}시간마다`);
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => {}), FIRST_CHECK_DELAY_MS);
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
}

const MANUAL_CHECK_TIMEOUT_MS = 15_000;

/** "업데이트 확인" 버튼 — 백그라운드 체크와 같은 `autoUpdater` 이벤트 스트림을
 * 쓰므로, 이번 수동 확인에 대한 결과만 한 번 받고 리스너를 정리한다. */
export function checkForUpdatesManually(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) return Promise.resolve({ status: 'disabled' });

  fileLogger.info('수동 확인 요청됨');
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
