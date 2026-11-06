/**
 * 준비: 사용자 맥에 없는 CLI를 공식 설치 스크립트로 깐다(조사 1절). sudo·Node·Homebrew가 필요 없다.
 *   Claude: curl -fsSL https://claude.ai/install.sh | bash -s stable   → ~/.local/bin/claude
 *   Codex:  CODEX_NON_INTERACTIVE=1 … https://chatgpt.com/codex/install.sh | sh → ~/.local/bin/codex
 *
 * 사용자 쉘 설정 파일을 건드리지 않는다: Codex 설치기는 PATH에 ~/.local/bin이 이미 있으면 .zprofile에 PATH 줄을 넣지 않는다
 * (install.sh add_to_path, 2026-11-06 확인). 그래서 그 폴더를 PATH 앞에 넣어 돌린다. HackMac은 CLI를 절대경로로 부르니 문제없다.
 * 비대화 모드에서 Codex 설치기의 질문("지금 실행?", "기존 npm 설치본 지우기?")은 전부 "아니요"다.
 * 스크립트 내용은 실행 때마다 받는다(고정하지 않는다 — 설치기가 바뀌면 그대로 따른다). 설치 뒤 `<bin> --version`으로 확인한다.
 */
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanEnv, resolveBin, type Vendor } from '../account/cli.ts';

export const INSTALL_SCRIPT: Record<Vendor, string> = {
  claude: 'curl -fsSL https://claude.ai/install.sh | bash -s stable',
  codex: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
};

export interface InstallView {
  state: 'running' | 'done' | 'failed';
  /** 화면에 보일 마지막 몇 줄 */
  output: string;
  /** 설치 뒤 확인한 실행 파일과 버전 */
  bin: string | null;
  version: string | null;
  error: string | null;
}

export interface InstallDeps {
  spawn: typeof nodeSpawn;
  home: string;
  /** 시험용: 설치 명령 바꾸기 */
  scripts?: Partial<Record<Vendor, string>>;
  /** 설치 뒤 CLI를 찾을 폴더(기본 ~/.local/bin) */
  binDirs?: () => string[];
  log?: (vendor: Vendor, text: string) => void;
  timeoutMs?: number;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export const installEnv = (home: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const env = cleanEnv({}, base);
  const local = join(home, '.local', 'bin');
  const rest = (env.PATH ?? '').split(':').filter((p) => p && p !== local);
  return { ...env, HOME: home, SHELL: env.SHELL ?? '/bin/zsh', PATH: [local, ...rest, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter((p, i, a) => a.indexOf(p) === i).join(':'), CODEX_NON_INTERACTIVE: '1' };
};

export const createInstalls = (deps: InstallDeps = { spawn: nodeSpawn, home: homedir() }) => {
  const jobs = new Map<Vendor, { child: ChildProcess; view: InstallView; out: string }>();
  const log = deps.log ?? (() => {});
  const binDirs = deps.binDirs ?? (() => [join(deps.home, '.local', 'bin')]);

  const verify = (vendor: Vendor, env: Record<string, string>): Promise<{ bin: string | null; version: string | null }> =>
    new Promise((resolve) => {
      const bin = resolveBin(vendor, binDirs());
      if (!bin) return resolve({ bin: null, version: null });
      const c = deps.spawn(bin, ['--version'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout?.on('data', (b: Buffer) => (out += b));
      c.stderr?.on('data', (b: Buffer) => (out += b));
      const t = setTimeout(() => c.kill('SIGKILL'), 20_000);
      c.on('error', () => { clearTimeout(t); resolve({ bin, version: null }); });
      c.on('close', (code) => { clearTimeout(t); resolve({ bin, version: code === 0 ? out.replace(ANSI, '').trim().split('\n')[0] || null : null }); });
    });

  return {
    state: (v: Vendor): InstallView | null => jobs.get(v)?.view ?? null,

    start(vendor: Vendor, onDone: (ok: boolean) => void): InstallView {
      const old = jobs.get(vendor);
      if (old?.view.state === 'running') return old.view;
      const script = deps.scripts?.[vendor] ?? INSTALL_SCRIPT[vendor];
      const env = installEnv(deps.home);
      log(vendor, `설치 시작: ${script}`);
      const child = deps.spawn('/bin/bash', ['-c', `set -o pipefail; ${script}`], { cwd: deps.home, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const job = { child, out: '', view: { state: 'running', output: '', bin: null, version: null, error: null } as InstallView };
      jobs.set(vendor, job);
      let settled = false;
      const finish = (view: Partial<InstallView>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        job.view = { ...job.view, ...view, output: job.out.slice(-1200) };
        log(vendor, `설치 끝: ${job.view.state}${job.view.error ? ` — ${job.view.error}` : ''}${job.view.version ? ` (${job.view.version})` : ''}`);
        onDone(job.view.state === 'done');
      };
      const onData = (b: Buffer) => {
        const text = b.toString().replace(ANSI, '').replace(/\r/g, '\n');
        log(vendor, text.trimEnd());
        job.out = (job.out + text).slice(-6000);
        job.view = { ...job.view, output: job.out.slice(-1200) };
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish({ state: 'failed', error: `${Math.round((deps.timeoutMs ?? 600_000) / 60_000)}분 안에 끝나지 않았어요` });
      }, deps.timeoutMs ?? 600_000);
      child.on('error', (e) => finish({ state: 'failed', error: e.message }));
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) {
          const last = job.out.trim().split('\n').filter(Boolean).at(-1) ?? '';
          finish({ state: 'failed', error: `설치 스크립트가 실패했어요(코드 ${code})${last ? `: ${last.slice(0, 200)}` : ''}` });
          return;
        }
        // 스크립트가 성공해도 실행 파일이 실제로 도는지 확인한다
        void verify(vendor, env).then((r) =>
          r.bin && r.version ? finish({ state: 'done', ...r }) : finish({ state: 'failed', ...r, error: r.bin ? `${vendor} --version이 돌지 않아요` : `설치 뒤 ${vendor}를 찾지 못했어요` }),
        );
      });
      return job.view;
    },
  };
};

export type Installs = ReturnType<typeof createInstalls>;
