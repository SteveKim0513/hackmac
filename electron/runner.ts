import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { cleanupOldLogs, startExecLog, zshVersion } from './exec-log';
import { popupClientJsPath, popupSocketPath, popupWrapperPath } from './paths';
import type { RunResult } from '../shared/types';

// 팝업(prompt/select/confirm)으로 사람 입력을 기다리는 스크립트는 그 응답
// 시간이 그대로 전체 실행 시간에 들어간다 — 제목 입력 + 프로젝트 선택처럼
// 팝업이 두 번만 연속으로 떠도 사람이 잠깐 생각하는 것만으로 30초를 넘긴다.
// 실제로 이 값이 30초였을 때 그런 정상적인 사용 흐름이 SIGTERM으로 조용히
// 죽어(로그에 원인 없이 "성공=false 코드=없음"만 남음) 사용자가 "안 눌렸나"
// 하고 단축키를 다시 눌러 같은 서비스가 중복 실행되는 문제로 이어졌다.
// 5분은 진짜로 멈춘(응답 없는) 스크립트를 잡아내는 안전장치 역할은
// 유지하면서, 정상적인 인터랙티브 흐름은 절대 여기 걸리지 않을 만큼 넉넉하다.
const TIMEOUT_MS = 300_000;
const OUTPUT_CAP = 4000;

/** Buffers partial chunks and emits complete lines — stdout/stderr data
 * events don't align with line boundaries. */
function lineSplitter(onLine: (line: string) => void) {
  let buffer = '';
  return {
    write(chunk: string) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    },
    flush() {
      if (buffer) {
        onLine(buffer);
        buffer = '';
      }
    },
  };
}

export function runScript(filePath: string, serviceId: string): Promise<RunResult> {
  return new Promise((resolve) => {
    try {
      fs.chmodSync(filePath, 0o755);
    } catch {
      // Bundled resources are already read-only-ish; best-effort only.
    }

    const log = startExecLog(filePath, serviceId);
    log.line(`실행 시작: ${filePath}`);
    log.line(`셸 버전: ${zshVersion()}`);
    log.line(`사용자 폴더: ${os.homedir()}`);
    log.line(`로그 파일: ${log.path}`);

    // cwd is the home directory, not Electron's own app-bundle path — closer
    // to what a shell prompt starts in, and keeps any relative path in a
    // script from resolving against an app-internal folder by accident.
    // 스크립트가 선택/입력 팝업이 필요하면 osascript 네이티브 다이얼로그
    // 대신 이 세 값으로 electron/popupServer.ts에 붙는다 — 자세한 프로토콜은
    // resources/bin/hackmac-popup, docs/design.md 참고.
    const child = spawn('/bin/zsh', [filePath], {
      timeout: TIMEOUT_MS,
      cwd: os.homedir(),
      env: {
        ...process.env,
        HACKMAC_POPUP: popupWrapperPath(),
        HACKMAC_POPUP_SOCK: popupSocketPath(),
        HACKMAC_ELECTRON_BIN: process.execPath,
        HACKMAC_POPUP_CLIENT_JS: popupClientJsPath(),
      },
    });
    log.line(`프로세스 기동: pid=${child.pid ?? '없음'}`);

    // 오래된 로그 폴더 정리는 스크립트 시작과 무관한 뒷정리라, 여기서 막
    // 띄운 프로세스 다음으로 미룬다 — 로그가 쌓여 있을수록 readdir/rm에
    // 걸리는 시간이 늘어나는데, 이걸 spawn보다 먼저 하면 단축키를 누르고
    // 다이얼로그가 뜨기까지의 체감 지연으로 그대로 이어진다.
    void cleanupOldLogs();
    let stdout = '';
    let stderr = '';
    const stdoutLog = lineSplitter((line) => log.line(line));
    const stderrLog = lineSplitter((line) => log.line(line));
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout = (stdout + text).slice(0, OUTPUT_CAP);
      stdoutLog.write(text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(0, OUTPUT_CAP);
      stderrLog.write(text);
    });
    child.on('close', (code, signal) => {
      stdoutLog.flush();
      stderrLog.flush();
      if (signal) log.line(`중단 신호를 받았습니다: ${signal}`);
      log.line('스크립트 종료');
      log.line(`종료 코드: ${code ?? '없음'}`);
      log.close();
      resolve({ success: code === 0, code, stdout, stderr, logPath: log.path });
    });
    child.on('error', (err) => {
      stdoutLog.flush();
      stderrLog.flush();
      log.line(`실행 오류: ${String(err)}`);
      log.line('스크립트 종료');
      log.close();
      resolve({ success: false, code: null, stdout, stderr: String(err), logPath: log.path });
    });
  });
}
