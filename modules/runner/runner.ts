/**
 * 실행기: 앱의 스크립트를 띄우고, 상주 앱은 살려 둔다. Node 기본 모듈만 쓴다. Electron이 아는 것(팝업 소켓 경로 등)은 env로 주입받는다.
 *
 * 1회 실행(hotkey·schedule·login·event): spawn → 로그 → 결과.
 * 상주(resident): 죽으면 1초→5초→30초 뒤 다시 띄운다. 10분 안에 5번 죽으면 그 앱만 끄고 사건을 남긴다(기획 5.3, 시작값).
 *   생존 신호는 stdout의 `HACKMAC_HEARTBEAT` 한 줄. manifest의 heartbeat(초) 안에 안 오면 멈춘 것으로 보고 끊는다.
 *
 * 스크립트가 받는 환경변수: HACKMAC_APP_DIR(패키지), HACKMAC_DATA_DIR(데이터), HACKMAC_SETTING_<KEY>, HACKMAC_SECRET_<KEY>,
 *   그리고 호출자가 주는 능력 env(HACKMAC_POPUP 등). 앱은 이 밖의 경로를 가정하지 않는다.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Trigger } from '../../shared/manifest.ts';
import { startExecLog } from './execlog.ts';

export const HEARTBEAT_LINE = 'HACKMAC_HEARTBEAT';
const OUTPUT_CAP = 4000;

/**
 * 스크립트는 새 프로세스 그룹으로 띄우고(detached) 끊을 때는 그룹째 죽인다. zsh만 죽이면 그 자식(sleep, osascript)이
 * stdout 파이프를 쥔 채 남아 'close'가 오지 않고, 타임아웃이 조용히 늘어난다.
 */
const spawnGroup = (shell: string, script: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess =>
  spawn(shell, [script], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });

const killGroup = (child: ChildProcess, signal: NodeJS.Signals): void => {
  if (child.pid === undefined) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* 이미 끝남 */ } }
};

/** 사건 원장에 남기는 것. 보관은 호출자가 한다(추가 전용 JSONL) */
export type RunnerEvent =
  | { kind: 'run.start'; appId: string; script: string; pid: number | null; logPath: string }
  /** stopped: 상주 앱을 HackMac이 일부러 끈 것(끄기·종료). 감시자는 이걸 실패로 세지 않는다 */
  | { kind: 'run.end'; appId: string; script: string; code: number | null; signal: string | null; ms: number; logPath: string; stopped?: boolean }
  | { kind: 'resident.restart'; appId: string; attempt: number; delayMs: number }
  | { kind: 'resident.hung'; appId: string; heartbeatSec: number }
  | { kind: 'resident.gaveup'; appId: string; crashes: number; windowMs: number };

export interface RunContext {
  appId: string;
  appDir: string;
  dataDir: string;
  settings: Record<string, string>;
  secrets: Record<string, string>;
  /** 능력이 주는 env(팝업 소켓 등) */
  env: Record<string, string>;
}

export interface RunResult { success: boolean; code: number | null; signal: string | null; stdout: string; stderr: string; logPath: string }

export interface RunnerOptions {
  logsRoot: string;
  onEvent: (e: RunnerEvent) => void;
  /** 1회 실행 상한. 팝업 응답 시간이 들어가므로 넉넉히(v1: 5분) */
  timeoutMs?: number;
  /** 상주 재시작 간격(시작값 1s·5s·30s). 시험은 짧게 */
  backoffMs?: number[];
  crashLimit?: number;
  crashWindowMs?: number;
  shell?: string;
}

const envKey = (k: string): string => k.toUpperCase().replace(/-/g, '_');

const buildEnv = (ctx: RunContext): NodeJS.ProcessEnv => ({
  ...process.env,
  HACKMAC_APP_DIR: ctx.appDir,
  HACKMAC_DATA_DIR: ctx.dataDir,
  ...Object.fromEntries(Object.entries(ctx.settings).map(([k, v]) => [`HACKMAC_SETTING_${envKey(k)}`, v])),
  ...Object.fromEntries(Object.entries(ctx.secrets).map(([k, v]) => [`HACKMAC_SECRET_${envKey(k)}`, v])),
  ...ctx.env,
});

const lineSplitter = (onLine: (line: string) => void) => {
  let buf = '';
  return {
    write(chunk: string) {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      lines.forEach(onLine);
    },
    flush() {
      if (buf) onLine(buf);
      buf = '';
    },
  };
};

export class Runner {
  private readonly o: Required<RunnerOptions>;
  private readonly residents = new Map<string, Resident>();

  constructor(options: RunnerOptions) {
    this.o = {
      timeoutMs: 300_000,
      backoffMs: [1_000, 5_000, 30_000],
      crashLimit: 5,
      crashWindowMs: 10 * 60_000,
      shell: '/bin/zsh',
      ...options,
    };
  }

  /** 스크립트를 띄우고 끝날 때까지 기다린다 */
  runOnce(ctx: RunContext, trigger: Trigger): Promise<RunResult> {
    return new Promise((resolve) => {
      const script = join(ctx.appDir, trigger.script);
      try { chmodSync(script, 0o755); } catch { /* 읽기 전용이어도 zsh가 파일 인자로 읽으므로 상관없다 */ }
      const log = startExecLog(this.o.logsRoot, ctx.appId, script);
      log.line(`실행 시작: ${trigger.script} (${trigger.kind})`);
      const started = Date.now();
      const child = spawnGroup(this.o.shell, script, ctx.dataDir, buildEnv(ctx));
      this.o.onEvent({ kind: 'run.start', appId: ctx.appId, script: trigger.script, pid: child.pid ?? null, logPath: log.path });
      let stdout = '';
      let stderr = '';
      const outL = lineSplitter((l) => log.line(l));
      const errL = lineSplitter((l) => log.line(`[stderr] ${l}`));
      child.stdout!.on('data', (c: Buffer) => { const t = c.toString(); stdout = (stdout + t).slice(0, OUTPUT_CAP); outL.write(t); });
      child.stderr!.on('data', (c: Buffer) => { const t = c.toString(); stderr = (stderr + t).slice(0, OUTPUT_CAP); errL.write(t); });
      const timer = setTimeout(() => { log.line(`${this.o.timeoutMs}ms 안에 끝나지 않음 — 끊는다`); killGroup(child, 'SIGTERM'); }, this.o.timeoutMs);
      const finish = (code: number | null, signal: string | null, err?: Error) => {
        clearTimeout(timer);
        outL.flush(); errL.flush();
        if (err) log.line(`실행 오류: ${String(err)}`);
        if (signal) log.line(`중단 신호: ${signal}`);
        log.line(`종료 코드: ${code ?? '없음'}`);
        log.close();
        this.o.onEvent({ kind: 'run.end', appId: ctx.appId, script: trigger.script, code, signal, ms: Date.now() - started, logPath: log.path });
        resolve({ success: code === 0, code, signal, stdout, stderr: err ? String(err) : stderr, logPath: log.path });
      };
      child.on('close', (code, signal) => finish(code, signal));
      child.on('error', (err) => finish(null, null, err));
    });
  }

  /** 상주 앱을 켠다. 이미 켜져 있으면 그대로 */
  startResident(ctx: RunContext, trigger: Extract<Trigger, { kind: 'resident' }>): void {
    if (this.residents.has(ctx.appId)) return;
    const r = new Resident(ctx, trigger, this.o, () => this.residents.delete(ctx.appId));
    this.residents.set(ctx.appId, r);
    r.spawnNow();
  }

  /** 상주 앱을 끈다. 끝날 때까지 기다린다 */
  async stopResident(appId: string): Promise<void> {
    const r = this.residents.get(appId);
    if (!r) return;
    this.residents.delete(appId);
    await r.stop();
  }

  isResidentRunning(appId: string): boolean {
    return this.residents.get(appId)?.alive ?? false;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.residents.keys()].map((id) => this.stopResident(id)));
  }
}

class Resident {
  private child: ChildProcess | null = null;
  private crashes: number[] = [];
  private attempt = 0;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private log: ReturnType<typeof startExecLog> | null = null;

  constructor(
    private readonly ctx: RunContext,
    private readonly trigger: Extract<Trigger, { kind: 'resident' }>,
    private readonly o: Required<RunnerOptions>,
    private readonly onGaveUp: () => void,
  ) {}

  get alive(): boolean { return this.child !== null && this.child.exitCode === null && this.child.signalCode === null; }

  spawnNow(): void {
    if (this.stopping) return;
    const script = join(this.ctx.appDir, this.trigger.script);
    try { chmodSync(script, 0o755); } catch { /* 위와 같다 */ }
    const log = startExecLog(this.o.logsRoot, this.ctx.appId, script);
    this.log = log;
    log.line(`상주 시작: ${this.trigger.script} (heartbeat ${this.trigger.heartbeat}s)`);
    const started = Date.now();
    const child = spawnGroup(this.o.shell, script, this.ctx.dataDir, buildEnv(this.ctx));
    this.child = child;
    this.o.onEvent({ kind: 'run.start', appId: this.ctx.appId, script: this.trigger.script, pid: child.pid ?? null, logPath: log.path });
    const outL = lineSplitter((l) => { if (l.trim() === HEARTBEAT_LINE) this.armHeartbeat(); else log.line(l); });
    const errL = lineSplitter((l) => log.line(`[stderr] ${l}`));
    child.stdout!.on('data', (c: Buffer) => outL.write(c.toString()));
    child.stderr!.on('data', (c: Buffer) => errL.write(c.toString()));
    this.armHeartbeat();
    child.on('close', (code, signal) => {
      outL.flush(); errL.flush();
      this.clearHeartbeat();
      log.line(`종료 코드: ${code ?? '없음'}${signal ? ` 신호 ${signal}` : ''}`);
      log.close();
      this.log = null;
      this.child = null;
      this.o.onEvent({ kind: 'run.end', appId: this.ctx.appId, script: this.trigger.script, code, signal, ms: Date.now() - started, logPath: log.path, ...(this.stopping ? { stopped: true } : {}) });
      if (!this.stopping) this.scheduleRestart();
    });
    child.on('error', (err) => { log.line(`실행 오류: ${String(err)}`); });
  }

  private armHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      if (!this.alive) return;
      this.log?.line(`생존 신호가 ${this.trigger.heartbeat}초 안에 없음 — 끊는다`);
      this.o.onEvent({ kind: 'resident.hung', appId: this.ctx.appId, heartbeatSec: this.trigger.heartbeat });
      if (this.child) killGroup(this.child, 'SIGKILL');
    }, this.trigger.heartbeat * 1000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private scheduleRestart(): void {
    const now = Date.now();
    this.crashes = [...this.crashes.filter((t) => now - t < this.o.crashWindowMs), now];
    if (this.crashes.length >= this.o.crashLimit) {
      this.o.onEvent({ kind: 'resident.gaveup', appId: this.ctx.appId, crashes: this.crashes.length, windowMs: this.o.crashWindowMs });
      this.stopping = true;
      this.onGaveUp();
      return;
    }
    const delayMs = this.o.backoffMs[Math.min(this.attempt, this.o.backoffMs.length - 1)];
    this.attempt += 1;
    this.o.onEvent({ kind: 'resident.restart', appId: this.ctx.appId, attempt: this.attempt, delayMs });
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.spawnNow(); }, delayMs);
  }

  stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.clearHeartbeat();
    const child = this.child;
    if (!child || !this.alive) return Promise.resolve();
    return new Promise((resolve) => {
      child.once('close', () => resolve());
      killGroup(child, 'SIGTERM');
      setTimeout(() => { if (this.alive) killGroup(child, 'SIGKILL'); }, 2_000).unref();
    });
  }
}
