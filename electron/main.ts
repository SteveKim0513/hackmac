import { app, BrowserWindow, ipcMain, Menu, shell, Tray } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { serviceCatalog } from './services';
import { createTrayIcon } from './tray-icon';
import { logsRoot } from './exec-log';
import { initAutoUpdate } from './updater';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ROOT = path.join(__dirname, '..');
process.env.APP_ROOT = APP_ROOT;
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(APP_ROOT, 'dist');

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
    backgroundColor: '#0c0c10',
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
  if (!gotSingleInstanceLock) return;

  // Packaged builds get the icon from build/icon.icns via electron-builder;
  // `npm run dev` runs the stock Electron binary, so the Dock would otherwise
  // show the generic Electron icon while iterating on this app's branding.
  if (VITE_DEV_SERVER_URL) {
    app.dock?.setIcon(path.join(APP_ROOT, 'build', 'icon.png'));
  }

  // 켜진 서비스가 로그인 직후부터 단축키를 받아야 하므로 앱 자체가 로그인 시
  // 자동 실행되게 등록한다. `npm run dev`의 Electron.app 경로로 등록되면 의미가
  // 없으니 패키지된 빌드에서만 설정한다. `openAsHidden`은 macOS 13 이후로는
  // 동작하지 않는 deprecated 옵션이라 넣지 않는다 — 창을 안 띄우는 건 아래
  // `wasOpenedAtLogin` 체크로 직접 처리한다.
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  serviceCatalog.init();
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

app.on('will-quit', () => {
  serviceCatalog.dispose();
});

ipcMain.handle('services:list', () => serviceCatalog.list());

ipcMain.handle('services:activate', (_e, id: string) => serviceCatalog.activate(id));

ipcMain.handle('services:deactivate', (_e, id: string) => serviceCatalog.deactivate(id));

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('logs:open', () => {
  const dir = logsRoot();
  fs.mkdirSync(dir, { recursive: true }); // nothing may have run yet
  return shell.openPath(dir);
});
