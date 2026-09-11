import net from 'node:net';
import fs from 'node:fs';
import { requestPopup } from './popupWindow';
import { popupClientJsPath, popupSocketPath, popupWrapperPath } from './paths';
import { appLog, describeError } from './log';
import type { PopupRequest, PopupResult } from '../shared/types';

/**
 * 서비스 스크립트(zsh, `/bin/zsh`로 실행됨)가 선택/입력 팝업을 그리려면
 * osascript가 아니라 이 앱이 그려야 한다 — CLAUDE.md의 "팝업은 Electron으로
 * 그린다" 원칙. 스크립트 프로세스에서 Electron 렌더러로 직접 IPC를 보낼
 * 방법이 없으니, 이 로컬 유닉스 소켓이 그 다리 역할을 한다:
 *
 *   스크립트 → resources/bin/hackmac-popup (zsh) →
 *   hackmac-popup-client.cjs (ELECTRON_RUN_AS_NODE=1로 실행되는 Node) →
 *   이 소켓 → popupWindow.ts가 실제 창을 띄우고 기다림 → 결과를 소켓으로 회신
 *
 * 요청/응답 둘 다 JSON 한 줄(개행으로 끝)이라 셸에서 직접 문자열을
 * 이어붙여 이스케이프할 필요가 없다 — 그 부분은 전부 Node 클라이언트가
 * JSON.stringify/parse로 처리한다.
 */
let server: net.Server | null = null;

function chmodExecutable(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o755);
  } catch (err) {
    appLog.warn('popup-server', `실행 권한 설정 실패: ${filePath} — ${describeError(err)}`);
  }
}

export function startPopupServer(): void {
  chmodExecutable(popupWrapperPath());
  chmodExecutable(popupClientJsPath());

  const sockPath = popupSocketPath();
  try {
    fs.unlinkSync(sockPath);
  } catch {
    // 정상 종료 후 재시작이면 이 파일이 아예 없는 게 보통 — 무시.
  }

  // allowHalfOpen 없이는(Node 기본값 false) 클라이언트가 `socket.end(data)`로
  // 요청을 쓰고 즉시 쓰기 방향을 닫는 순간, 응답을 아직 안 보냈어도 Node가
  // 소켓을 통째로 destroy해버린다 — 사람이 실제로 팝업에 답할 때까지 수백ms를
  // 기다리는 이 서버에서는 응답을 보낼 때쯤 소켓이 이미 죽어 있어 매번
  // 조용히 유실된다(e2e에서 실제로 이렇게 재현됨: handleRequest는 정확한
  // 값으로 끝나는데 socket.end() 시점엔 이미 destroyed=true). 이 옵션으로
  // "상대가 다 썼다고 닫아도 내가 쓸 건 마저 쓴다"를 켜야 한다.
  server = net.createServer({ allowHalfOpen: true }, (socket) => {
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // 처리한 줄은 버퍼에서 잘라낸다 — 한 연결에 요청 하나만 오지만, 혹시
      // 'data'가 여러 조각으로 나뉘어 온 뒤 그중 하나가 줄 전체를 포함하는
      // 경우에도 같은 줄을 중복 처리하지 않도록.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        void handleRequest(line, socket);
      }
    });
    socket.on('error', (err) => {
      appLog.warn('popup-server', `연결 오류: ${describeError(err)}`);
    });
  });

  server.on('error', (err) => {
    appLog.error('popup-server', `팝업 소켓 서버 오류: ${sockPath} — ${describeError(err)}`);
  });

  server.listen(sockPath, () => {
    appLog.info('popup-server', `팝업 소켓 대기 시작: ${sockPath}`);
  });
}

async function handleRequest(line: string, socket: net.Socket): Promise<void> {
  let result: PopupResult;
  try {
    const req = JSON.parse(line) as PopupRequest;
    result = await requestPopup(req);
  } catch (err) {
    appLog.error('popup-server', `요청 처리 실패: ${describeError(err)}`);
    result = { ok: false, value: null };
  }
  socket.end(JSON.stringify(result) + '\n');
}

export function stopPopupServer(): void {
  server?.close();
  server = null;
  try {
    fs.unlinkSync(popupSocketPath());
  } catch {
    // best-effort — 다음 시작 때 startPopupServer가 어차피 다시 지운다.
  }
}
