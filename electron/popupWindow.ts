import { BrowserWindow, app, ipcMain, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appLog, describeError } from './log';
import type { PopupRequest, PopupResult } from '../shared/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
const RENDERER_DIST = path.join(APP_ROOT, 'dist');

const WIDTH = 440;
const ROW_HEIGHT = 40;
const MAX_VISIBLE_ROWS = 6;
const GROUP_HEADER_HEIGHT = 26;

// e2e/popup.spec.ts가 세우는 조건과 동일 — main.ts 참고. 여기서도 독립적으로
// 읽는 이유는 이 모듈이 main.ts에 의존하지 않고도 단독으로 테스트 가능하게
// 두기 위해서다.
const E2E_QUIET = process.env.HACKMAC_E2E_QUIET === '1' && !process.env.CI;

function computeHeight(req: PopupRequest): number {
  if (req.kind === 'status') return 108;
  if (req.kind === 'prompt') return 188;
  if (req.kind === 'date') return 404;
  if (req.kind === 'select') {
    const rows = Math.max(1, Math.min(req.items.length, MAX_VISIBLE_ROWS));
    // 구간 헤더("업무"/"개인" 등)는 그룹이 바뀔 때마다 한 줄씩 추가로
    // 차지한다 — PopupApp.tsx의 렌더링과 같은 규칙(연속된 같은 그룹은 헤더
    // 하나만)으로 세어야 높이가 맞는다.
    let headerCount = 0;
    let lastGroup: string | null = null;
    for (const item of req.items) {
      if (item.group !== lastGroup && item.group) headerCount++;
      lastGroup = item.group;
    }
    return 168 + rows * ROW_HEIGHT + headerCount * GROUP_HEADER_HEIGHT;
  }
  // confirm은 한 줄짜리 확인 문구("지금 3개 진행중이에요…")부터 여러 줄짜리
  // 현황 요약(04-status.sh)까지 길이가 크게 다르다 — 줄 수만큼 늘리되 너무
  // 길면 popup.css의 .popup-body 스크롤에 맡긴다.
  const lines = req.prompt.split('\n').length;
  return Math.min(480, 126 + lines * 19);
}

// 스크립트 하나가 다이얼로그를 순서대로 여러 번 띄울 수 있고(예:
// 07-normalize류), 서로 다른 단축키가 거의 동시에 눌릴 수도 있다. 팝업 창
// 두 개가 동시에 뜨면 어느 쪽이 포커스를 받았는지 사용자가 구분할 수 없으니,
// 한 번에 하나만 뜨도록 이 프라미스 체인으로 요청을 직렬화한다 — 두 번째
// 요청은 첫 번째 팝업이 닫힐 때까지 그냥 기다린다.
let queue: Promise<unknown> = Promise.resolve();

export function requestPopup(req: PopupRequest): Promise<PopupResult> {
  const run = () =>
    showPopup(req).catch((err) => {
      appLog.error('popup', `팝업 표시 실패: ${describeError(err)}`);
      return { ok: false, value: null } as PopupResult;
    });
  const result = queue.then(run);
  // 이전 요청이 실패해도 큐가 끊기면 안 되므로 체인 자체는 항상 성공하는
  // run()의 반환값을 잇는다 (run 내부에서 이미 catch됨).
  queue = result;
  return result;
}

/** select/prompt/confirm/date/status 창이 공유하는 크롬 없는 BrowserWindow
 * 설정 — 위치·프레임·투명도만 여기서 정하고, 내용물 로드와 IPC 배선은
 * 호출자(showPopup/showRunningStatus)가 각자의 필요에 맞게 따로 한다. */
function createChromelessWindow(height: number): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const width = WIDTH;

  const win = new BrowserWindow({
    width,
    height,
    // Playwright는 CDP로 창을 읽으므로 실제로 화면에 보일 필요가 없다 —
    // 디스플레이 밖 좌표에 띄워 자동화 실행 중에도 화면을 가리지 않는다.
    ...(E2E_QUIET
      ? { x: -3000, y: -3000 }
      : {
          x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
          y: Math.round(display.workArea.y + display.workArea.height * 0.3),
        }),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return win;
}

function loadPopupContent(win: BrowserWindow): void {
  const query = { mode: 'popup' };
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.searchParams.set('mode', 'popup');
    win.loadURL(url.toString());
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'), { query });
  }
}

function showInWindow(win: BrowserWindow): void {
  win.once('ready-to-show', () => {
    if (E2E_QUIET) {
      // Playwright는 focus 없이도 CDP로 창 내용을 읽고 조작할 수 있다 —
      // 자동화 실행 중에 다른 창의 키보드 포커스를 뺏지 않는다.
      win.showInactive();
    } else {
      app.focus({ steal: true });
      win.show();
      win.focus();
    }
  });
}

// 단축키를 누른 직후부터 스크립트의 첫 실제 팝업(또는 종료)까지 화면에
// 아무 피드백이 없으면, 사람이 "안 눌렸나" 하고 단축키를 다시 눌러 같은
// 서비스가 중복 실행되는 문제로 이어졌다(electron/services.ts의 실행 로그로
// 실제로 확인됨). 이 창은 그 공백을 메우는 "지금 실행 중" 표시로, 스크립트가
// 아니라 electron/services.ts가 단축키 콜백에서 직접 띄우고 닫는다 — 위
// `queue` 직렬화 대상이 아닌 별도 생명주기다.
let statusWin: BrowserWindow | null = null;

export function showRunningStatus(label: string): void {
  const req: PopupRequest = { kind: 'status', title: '', prompt: label };
  if (statusWin && !statusWin.isDestroyed()) {
    statusWin.webContents.send('popup:init', req);
    return;
  }
  const win = createChromelessWindow(computeHeight(req));
  statusWin = win;
  win.on('closed', () => {
    if (statusWin === win) statusWin = null;
  });
  ipcMain.once('popup:ready', () => {
    if (!win.isDestroyed()) win.webContents.send('popup:init', req);
  });
  showInWindow(win);
  loadPopupContent(win);
}

/** 실제 팝업이 뜨거나(showPopup 진입 시) 스크립트가 끝나면(services.ts) 호출된다 —
 * 둘 중 뭐가 먼저 오든 안전하게 아무 일도 안 하거나 창을 닫는다. */
export function hideRunningStatus(): void {
  if (statusWin && !statusWin.isDestroyed()) statusWin.close();
  statusWin = null;
}

function showPopup(req: PopupRequest): Promise<PopupResult> {
  // 스크립트가 실제 팝업을 요청했다는 건 "실행 중" 표시가 할 일을 다 했다는
  // 뜻이다 — 두 창이 겹쳐 보이지 않도록 새 창을 만들기 전에 먼저 치운다.
  hideRunningStatus();
  return new Promise((resolve) => {
    const win = createChromelessWindow(computeHeight(req));

    let settled = false;
    const finish = (result: PopupResult) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener('popup:resolve', onResolve);
      ipcMain.removeListener('popup:ready', onReady);
      resolve(result);
      if (!win.isDestroyed()) win.close();
    };

    function onResolve(_e: Electron.IpcMainEvent, value: PopupResult) {
      finish(value);
    }
    // 렌더러가 IPC 리스너를 붙인 뒤 스스로 준비됐다고 알려올 때까지 기다렸다가
    // popup:init을 보낸다 — `ready-to-show`(첫 프레임 렌더 시점)에 바로 보내면
    // React가 아직 마운트 전이라 이벤트를 놓칠 수 있다.
    function onReady() {
      if (!win.isDestroyed()) win.webContents.send('popup:init', req);
    }
    ipcMain.once('popup:resolve', onResolve);
    ipcMain.once('popup:ready', onReady);

    win.on('closed', () => finish({ ok: false, value: null }));

    showInWindow(win);
    loadPopupContent(win);
  });
}
