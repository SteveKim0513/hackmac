import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

export interface AppHandle {
  app: ElectronApplication;
  page: Page;
  userData: string;
  cleanup: () => Promise<void>;
}

/**
 * 패키지 빌드된(dist-electron/main.js) HackMac을 격리된 userData로 띄운다 —
 * 실제 실행 중인 앱이나 다른 테스트 인스턴스와 설정 파일·popup 소켓·
 * requestSingleInstanceLock이 전혀 겹치지 않는다 (electron/main.ts의
 * HACKMAC_USER_DATA). `HACKMAC_E2E_QUIET=1`은 창을 화면 밖에 띄운다 —
 * Playwright는 CDP로 창 내용을 읽으므로 실제로 보일 필요가 없다.
 *
 * `npm run test:e2e`가 먼저 `npm run build`를 실행해 이 파일을 만들어둔다.
 */
export async function launchApp(): Promise<AppHandle> {
  const userData = mkdtempSync(join(tmpdir(), 'hackmac-userData-'));

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  // VS Code 등 개발 셸이 기본으로 걸어두는 값 — 켜져 있으면 Electron이 창을
  // 띄우는 대신 그냥 Node로 실행된다 (CLAUDE.md "환경에서 겪은 것들" 참고).
  delete env.ELECTRON_RUN_AS_NODE;
  env.HACKMAC_USER_DATA = userData;
  env.HACKMAC_E2E_QUIET = '1';

  // REPO_ROOT(파일이 아니라 디렉터리)를 넘겨야 Electron이 REPO_ROOT/package.json의
  // "main"(dist-electron/main.js)을 읽어 app.getAppPath()를 REPO_ROOT로 잡는다 —
  // dist-electron/main.js를 직접 넘기면 app.getAppPath()가 dist-electron/ 자체가
  // 돼버려서 electron/paths.ts의 servicesDir()이 resources/services를 못 찾는다
  // (실제로 이렇게 서비스 0개로 실패하는 걸 확인한 뒤 고침).
  const app = await electron.launch({
    args: [REPO_ROOT],
    env,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const cleanup = async () => {
    await app.close().catch(() => {});
    rmSync(userData, { recursive: true, force: true });
  };

  return { app, page, userData, cleanup };
}

export interface PopupCliResult {
  stdout: string;
  status: number | null;
}

/**
 * `launchApp()`으로 띄운 인스턴스의 실제 popup 소켓에, 서비스 스크립트가 쓰는
 * 것과 완전히 같은 CLI(`resources/bin/hackmac-popup`)로 요청을 보낸다.
 *
 * 이 CLI 호출은 실제 팝업 창이 화면에서(정확히는 화면 밖에서) 응답을 받을
 * 때까지 끝나지 않는다 — 그래서 `await`하지 않고 프라미스만 받아둔 채로
 * `app.waitForEvent('window')`로 그 사이 뜬 팝업 창을 잡아 Playwright로
 * 클릭/입력한 다음에야 이 프라미스가 풀린다. 이렇게 해야 "CLI 호출 → 실제
 * 창 렌더링 → 사람의 클릭/키보드 → 그 값이 다시 CLI stdout으로" 전체
 * 파이프라인을 실제로 검증하게 된다 — 소켓 프로토콜만 흉내내는 목업이 아니다.
 */
export function callPopupCli(userData: string, args: string[]): Promise<PopupCliResult> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.ELECTRON_RUN_AS_NODE;
  env.HACKMAC_POPUP_SOCK = join(userData, 'popup.sock');
  env.HACKMAC_ELECTRON_BIN = join(REPO_ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  env.HACKMAC_POPUP_CLIENT_JS = join(REPO_ROOT, 'resources/bin/hackmac-popup-client.cjs');

  return new Promise((resolve) => {
    const child = spawn(join(REPO_ROOT, 'resources/bin/hackmac-popup'), args, { env });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('close', (status) => resolve({ stdout, status }));
  });
}
