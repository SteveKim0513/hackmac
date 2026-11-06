/**
 * 실행 로그: 실행마다 파일 하나. 스크립트가 무엇을 하든 모든 실행이 여기를 지나므로, 작성자가 잊어도 기록은 남는다.
 * <root>/<app-id>/<날짜>/<스크립트>-<시각>.log. v1 electron/exec-log.ts와 같은 모양이고 root만 주입받는다.
 */
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
const stamp = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
const dateFolder = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// 밀리초까지: 상주 앱이 같은 초에 두 번 다시 뜨면 파일이 겹친다
const fileStamp = (d: Date): string => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;

export interface ExecLog { path: string; line(text: string): void; close(): void }

export const startExecLog = (root: string, appId: string, scriptPath: string): ExecLog => {
  const now = new Date();
  const dir = join(root, appId, dateFolder(now));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${basename(scriptPath, '.sh')}-${fileStamp(now)}-${process.pid}.log`);
  const fd = openSync(path, 'a');
  return {
    path,
    line: (text) => writeSync(fd, `[${stamp(new Date())}] ${text}\n`),
    close: () => closeSync(fd),
  };
};
