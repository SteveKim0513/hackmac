/**
 * 로그인을 공식 CLI의 흐름으로 돌린다(스튜디오 src/login.ts에서 가져옴).
 *   Claude: `claude auth login --claudeai`가 브라우저를 연다. 브라우저가 코드를 보여 주면 CLI가 "Paste code"로 기다린다 →
 *           화면이 코드를 받아 submit()으로 CLI의 stdin에 넣는다. 로컬 콜백으로 바로 끝나는 경우도 있다.
 *   Codex:  `codex login`이 브라우저를 열고 localhost:1455 콜백으로 끝난다. `--device-auth`는 쓰지 않는다:
 *           사용자가 ChatGPT 보안 설정에서 미리 켜야 하고, 안 켜져 있으면 브라우저 로그인으로 조용히 떨어진다(조사 2절).
 * 브라우저가 안 열렸을 때를 위해 CLI가 낸 주소를 화면에 보인다.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { cleanEnv, resolveBin, type Vendor } from './cli.ts';

export interface LoginView {
  state: 'pending' | 'done' | 'failed';
  /** CLI가 낸 로그인 주소(브라우저가 안 열렸으면 사용자가 연다) */
  url: string | null;
  /** Claude가 브라우저에서 받은 코드를 기다리는 중 */
  needsCode: boolean;
  /** CLI 출력의 끝(실패 이유를 보이는 데 쓴다) */
  output: string;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export interface LoginDeps {
  spawn: typeof nodeSpawn;
  bin: (name: Vendor) => string | null;
  /** 로그인 과정의 줄을 파일에 남긴다(실패 원인을 나중에 볼 수 있게) */
  log?: (id: string, text: string) => void;
  /** 버려진 로그인을 끊을 때까지(기본 15분) */
  abandonMs?: number;
}

/** 폴더 안 login-<id>.log에 시각과 함께 덧붙인다. 못 써도 로그인은 계속한다 */
export const fileLogger = (dir: string) => (id: string, text: string): void => {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `login-${id}.log`), `${new Date().toISOString()} ${text.replace(/\n$/, '')}\n`, { mode: 0o600 });
  } catch {
    // 보조 기록이라 못 써도 된다
  }
};

export const viewFromOutput = (view: LoginView, out: string, vendor: Vendor): LoginView => ({
  ...view,
  url: out.match(/https:\/\/\S+/)?.[0] ?? view.url,
  needsCode: vendor === 'claude' && /paste code/i.test(out),
  output: out.slice(-800),
});

export const loginArgs = (vendor: Vendor): string[] => (vendor === 'claude' ? ['auth', 'login', '--claudeai'] : ['login']);

interface Job { child: ChildProcess; view: LoginView; out: string }

export const createLogins = (deps: LoginDeps = { spawn: nodeSpawn, bin: (n) => resolveBin(n) }) => {
  const jobs = new Map<string, Job>();
  const log = deps.log ?? (() => {});
  return {
    state: (id: string): LoginView | null => jobs.get(id)?.view ?? null,

    /** id: 계정 하나를 가리키는 이름(기본 계정은 vendor 이름). env: 그 계정의 설정 폴더 변수 */
    start(id: string, vendor: Vendor, env: Record<string, string>, onExit: (ok: boolean) => void): LoginView {
      const old = jobs.get(id);
      if (old?.view.state === 'pending') return old.view;
      const bin = deps.bin(vendor);
      if (!bin) {
        log(id, `실패: ${vendor} 명령을 찾지 못함`);
        return { state: 'failed', url: null, needsCode: false, output: `${vendor} 명령을 찾지 못했어요` };
      }
      const args = loginArgs(vendor);
      log(id, `시작: ${bin} ${args.join(' ')} (${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ') || '기본 계정'})`);
      const child = deps.spawn(bin, args, { env: cleanEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
      const job: Job = { child, out: '', view: { state: 'pending', url: null, needsCode: false, output: '' } };
      jobs.set(id, job);
      let settled = false;
      const finish = (ok: boolean, output: string) => {
        if (settled) return;
        settled = true;
        job.view = { ...job.view, state: ok ? 'done' : 'failed', needsCode: false, output };
        onExit(ok);
      };
      const onData = (b: Buffer) => {
        const text = b.toString().replace(ANSI, '');
        log(id, `출력: ${text.trimEnd()}`);
        job.out = (job.out + text).slice(-6000);
        job.view = viewFromOutput(job.view, job.out, vendor);
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.stdin?.on('error', () => {});
      child.on('exit', (code, signal) => {
        log(id, `끝: 종료 ${code ?? '없음'}${signal ? ` (신호 ${signal})` : ''}`);
        finish(code === 0, job.out.slice(-800));
      });
      child.on('error', (e) => {
        log(id, `오류: ${e.message}`);
        finish(false, e.message);
      });
      setTimeout(() => job.view.state === 'pending' && child.kill(), deps.abandonMs ?? 15 * 60_000).unref();
      return job.view;
    },

    /** Claude가 기다리는 코드를 넘긴다 */
    submit(id: string, code: string): LoginView | null {
      const j = jobs.get(id);
      if (j?.view.state === 'pending') {
        log(id, '코드를 받아 CLI에 넘김');
        j.child.stdin?.write(`${code.trim()}\n`);
      }
      return j?.view ?? null;
    },

    cancel(id: string): void {
      const j = jobs.get(id);
      if (j?.view.state === 'pending') j.child.kill();
      jobs.delete(id);
    },
  };
};

export type Logins = ReturnType<typeof createLogins>;
