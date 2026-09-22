import { app, BrowserWindow, ipcMain, Menu, nativeTheme, powerSaveBlocker, shell, Tray } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { serviceCatalog } from './services';
import { createTrayIcon } from './tray-icon';
import { logsRoot } from './exec-log';
import { checkForUpdatesManually, initAutoUpdate } from './updater';
import { appLog, describeError } from './log';
import { startPopupServer, stopPopupServer } from './popupServer';
import { loadSettings, saveSettings } from './settings';
import type { ThemePreference } from '../shared/types';

// 백그라운드 트레이 유틸리티라, 예상 못한 예외 하나 때문에 이미 켜둔 서비스의
// 단축키가 전부 죽어버리면 안 된다 — 원인은 로그로 남기고 프로세스는 계속
// 살려서 다른 서비스의 단축키는 계속 동작하게 한다. Node 기본 동작(로그 없이
// 그냥 죽음)이 바로 "왜 꺼졌는지 알 수 없는" 문제의 근원이었다.
process.on('uncaughtException', (err) => {
  appLog.error('process', `uncaughtException: ${describeError(err)}`);
});
process.on('unhandledRejection', (reason) => {
  appLog.error('process', `unhandledRejection: ${describeError(reason)}`);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, '..');
process.env.APP_ROOT = APP_ROOT;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(APP_ROOT, 'dist');

// e2e/helpers.ts가 각 테스트를 격리된 userData로 띄운다 — 실행 중인 실제 앱과
// 소켓/설정 파일/단일 인스턴스 락이 전혀 겹치지 않게 하려는 것. CI(및 이
// 앱을 시작하는 자동화 세션)에서는 실제 사람이 화면을 보지 않으므로,
// 이어지는 창들도 화면 밖에 조용히 띄운다 — mind-map-mac의 MINDMAP_E2E_QUIET과
// 같은 패턴, 자세한 이유는 docs/e2e.md 참고.
const E2E_QUIET = process.env.HACKMAC_E2E_QUIET === '1' && !process.env.CI;
if (process.env.HACKMAC_USER_DATA) {
  app.setPath('userData', process.env.HACKMAC_USER_DATA);
}

// A second launch must not spin up a second hotkey set for the already-active
// services — hand off to the already-running instance instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 700,
    minWidth: 760,
    minHeight: 520,
    title: 'HackMac',
    titleBarStyle: 'hiddenInset',
    // macOS 기본 위치(대략 x:13~20, 버전마다 다름)에 맡기면 트래픽라이트와
    // "HackMac" 제목 사이 간격이 OS 버전에 따라 들쭉날쭉해진다 — 직접 고정해
    // src/theme.css의 .app-shell 왼쪽 여백(92px)과 정확히 맞춘다.
    trafficLightPosition: { x: 20, y: 20 },
    // src/theme.css의 --bg(라이트 #fbfbfd/다크 #1c1c1e)와 맞춰 초기 로드시
    // 깜빡임 방지 — nativeTheme.themeSource는 whenReady 초입에서 이미
    // 저장된 사용자 설정으로 세팅해둔 뒤라 여기서 바로 현재 값을 읽을 수 있다.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#fbfbfd',
    // Playwright는 CDP로 창 내용을 그대로 읽으므로 화면에 보일 필요가 없다 —
    // 실제 디스플레이 밖 좌표에 띄워 화면을 가리지 않는다.
    ...(E2E_QUIET ? { x: -3000, y: -3000 } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// A minimal custom app menu still needs Edit-role items, or ⌘C/⌘V/⌘A stop
// working anywhere in the renderer.
function buildAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
    },
    {
      label: '편집',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('HackMac');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'HackMac 열기', click: () => createMainWindow() },
      { type: 'separator' },
      { label: '종료', role: 'quit' },
    ]),
  );
}

app.whenReady().then(() => {
  appLog.info('main', `앱 시작 — v${app.getVersion()}, packaged=${app.isPackaged}, loginItem=${app.getLoginItemSettings().wasOpenedAtLogin}`);
  if (!gotSingleInstanceLock) {
    appLog.info('main', '이미 실행 중인 인스턴스가 있어 종료함 (single instance lock)');
    return;
  }

  // 창을 만들기 전에 먼저 적용해야 위 backgroundColor 계산과 트래픽라이트
  // 등 네이티브 크롬이 처음부터 올바른 밝기로 뜬다.
  nativeTheme.themeSource = loadSettings().themePreference;
  // 렌더러가 `prefers-color-scheme` 미디어쿼리만으로 이 값을 알아내는 데
  // 의존하지 않는다 — 오프스크린으로 뜨는 창(E2E, 트레이에서 조용히 열기)에서
  // macOS의 다크모드 신호가 Chromium 렌더러까지 실시간으로 안 붙는 경우를
  // 실제로 겪었다(nativeTheme.shouldUseDarkColors는 true인데 렌더러의
  // matchMedia는 계속 false). 그래서 src/main.tsx가 이 이벤트를 IPC로 직접
  // 받아 `<html data-theme>`를 강제로 세팅하고, src/theme.css는 미디어쿼리
  // 대신 이 속성을 기준으로 다크 토큰을 켠다.
  nativeTheme.on('updated', () => {
    const isDark = nativeTheme.shouldUseDarkColors;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('theme:changed', isDark);
    }
  });

  // 메뉴바 트레이 아이콘만 쓰는 백그라운드 유틸리티라 Dock 아이콘은 안 띄운다.
  // 패키지 빌드는 Info.plist의 LSUIElement(build.mac.extendInfo)가 이걸
  // 대신해주지만, `npm run dev`는 electron-builder를 안 거치는 순정
  // Electron 바이너리라 여기서 직접 숨겨야 한다.
  app.dock?.hide();

  // 'accessory' 정책은 dock.hide()에 더해 "실행 시 자동으로 최전면 활성화"까지
  // 막아준다 — E2E는 사람이 화면을 보지 않는 자동화 실행이라, 다른 창의
  // 키보드 포커스를 뺏지 않게 이 정책까지 켠다(mind-map-mac과 같은 패턴).
  if (E2E_QUIET && process.platform === 'darwin') {
    app.setActivationPolicy('accessory');
  }

  // 켜진 서비스가 로그인 직후부터 단축키를 받아야 하므로 앱 자체가 로그인 시
  // 자동 실행되게 등록한다. `npm run dev`의 Electron.app 경로로 등록되면 의미가
  // 없으니 패키지된 빌드에서만 설정한다. `openAsHidden`은 macOS 13 이후로는
  // 동작하지 않는 deprecated 옵션이라 넣지 않는다 — 창을 안 띄우는 건 아래
  // `wasOpenedAtLogin` 체크로 직접 처리한다.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  // Dock 아이콘도 없고(LSUIElement) 눈에 보이는 창도 없이 오래 떠있는
  // 백그라운드 유틸리티라, macOS가 App Nap으로 메인 프로세스 자체를
  // 스로틀링한다 — 그 상태에서 전역 단축키를 누르면 spawn/팝업 창 생성이
  // 몇 초씩 늦게 반응하는데(사용자 리포트: "한참 있다가 나와서 여러 번
  // 누르게 됨"), 어떤 즉각적 피드백도 없어 오류로 오인하기 쉽다.
  // prevent-app-suspension으로 앱 전체 생명주기 동안 App Nap을 꺼서 유휴
  // 시간이 길어도 단축키 반응 속도가 떨어지지 않게 한다.
  powerSaveBlocker.start('prevent-app-suspension');

  serviceCatalog.init();
  startPopupServer();
  initAutoUpdate();
  buildAppMenu();
  // 로그인 때 자동으로 뜬 실행은 트레이만 띄우고 창은 열지 않는다 — 매번
  // 부팅 직후 창이 화면을 가로채면 백그라운드 유틸리티라는 컨셉과 어긋난다.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) {
    createMainWindow();
  }
  createTray();

  app.on('activate', () => createMainWindow());
  app.on('second-instance', () => createMainWindow());
});

// A background utility app: closing the window should not quit the app,
// since active services' global hotkeys need to keep working.
app.on('window-all-closed', () => {});

// 렌더러(창)가 죽어도 uncaughtException처럼 메인 프로세스 로그에 아무 흔적이
// 안 남는다 — "창이 갑자기 하얗게 됐다"류 리포트를 로그만 보고 진단하려면
// 이 이벤트가 유일한 단서다.
app.on('render-process-gone', (_e, _wc, details) => {
  appLog.error('main', `렌더러 프로세스 종료: reason=${details.reason}, exitCode=${details.exitCode}`);
});
app.on('child-process-gone', (_e, details) => {
  appLog.error('main', `자식 프로세스 종료: type=${details.type}, reason=${details.reason}, exitCode=${details.exitCode}`);
});

app.on('will-quit', () => {
  appLog.info('main', '앱 종료');
  serviceCatalog.dispose();
  stopPopupServer();
});

ipcMain.handle('services:list', () => serviceCatalog.list());

ipcMain.handle('services:activate', (_e, id: string) => serviceCatalog.activate(id));

ipcMain.handle('services:deactivate', (_e, id: string) => serviceCatalog.deactivate(id));

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('theme:get', () => loadSettings().themePreference);

ipcMain.handle('theme:set', (_e, pref: ThemePreference) => {
  nativeTheme.themeSource = pref;
  saveSettings({ themePreference: pref });
});

ipcMain.handle('theme:getEffectiveDark', () => nativeTheme.shouldUseDarkColors);

ipcMain.handle('updates:check', () => checkForUpdatesManually());

ipcMain.handle('logs:open', async () => {
  const dir = logsRoot();
  try {
    fs.mkdirSync(dir, { recursive: true }); // nothing may have run yet
  } catch (err) {
    appLog.error('main', `로그 폴더 생성 실패: ${dir} — ${describeError(err)}`);
    return String(err);
  }
  // shell.openPath resolves to an error string on failure (empty string on
  // success) rather than throwing or rejecting — easy to lose silently.
  const openError = await shell.openPath(dir);
  if (openError) appLog.error('main', `로그 폴더 열기 실패: ${dir} — ${openError}`);
  return openError;
});
