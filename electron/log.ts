import fs from 'node:fs';
import path from 'node:path';
import { logsRoot } from './exec-log';

type Level = 'info' | 'warn' | 'error' | 'debug';

const MAX_BYTES = 2_000_000;

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function timestamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/**
 * Finder에서 실행된 packaged 앱은 터미널이 없어 console.*이 어디로도 가지
 * 않는다 (Console.app에도 안 남는 게 electron/updater.ts에서 확인됨). 이
 * 파일을 거치는 로그만 사후에 확인 가능한 유일한 기록이라, 앱 자체 동작
 * (서비스 로딩, 단축키 등록, 설정 읽기/쓰기, 예상 못한 예외 등)을 남기는
 * 곳은 전부 console 대신 이걸 쓴다. 스크립트 실행 한 건씩의 상세 로그는
 * 성격이 달라 exec-log.ts가 날짜별 파일로 따로 남긴다.
 */
export function createFileLogger(fileName: string) {
  const filePath = path.join(logsRoot(), fileName);

  function rotateIfNeeded(): void {
    try {
      const { size } = fs.statSync(filePath);
      if (size < MAX_BYTES) return;
      fs.renameSync(filePath, `${filePath}.1`);
    } catch {
      // 파일이 아직 없거나 rename 실패 — 다음 append가 새로 만들면 그만이다.
    }
  }

  function write(level: Level, tag: string, message: string): void {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      rotateIfNeeded();
      fs.appendFileSync(filePath, `[${timestamp()}] [${level.toUpperCase()}] [${tag}] ${message}\n`);
    } catch {
      // 로그 기록 실패가 앱 동작을 막으면 안 된다 — best-effort.
    }
  }

  return {
    path: filePath,
    info: (tag: string, message: string) => write('info', tag, message),
    warn: (tag: string, message: string) => write('warn', tag, message),
    error: (tag: string, message: string) => write('error', tag, message),
    debug: (tag: string, message: string) => write('debug', tag, message),
  };
}

export type FileLogger = ReturnType<typeof createFileLogger>;

/** 앱 전역 동작을 남기는 공용 로그 (electron/*.ts 전반에서 사용). */
export const appLog = createFileLogger('app.log');

/** 에러/예외를 사람이 읽을 수 있는 한 줄로 정리 — stack이 있으면 stack까지. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  return String(err);
}

/**
 * 서비스 개수가 늘어날수록 app.log 한 파일 안에 여러 서비스의 줄이 섞인다.
 * 메시지 안에 자유 텍스트로 id를 적으면 문구가 조금만 달라져도 grep이
 * 깨지니, 항상 이 고정된 토큰 형태(`service=<id>`)로 앞에 붙여서
 * `grep "service=gtd-reminders" app.log`가 문구와 무관하게 항상 되게 한다.
 */
export function serviceTag(id: string): string {
  return `service=${id}`;
}
