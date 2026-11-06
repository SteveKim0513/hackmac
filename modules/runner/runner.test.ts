import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Runner, type RunContext, type RunnerEvent } from './runner.ts';

let tmp: string;
let events: RunnerEvent[];
let ctx: RunContext;

const writeScript = (name: string, body: string): string => {
  const p = join(ctx.appDir, 'scripts', name);
  writeFileSync(p, `#!/bin/zsh\n${body}\n`);
  return `scripts/${name}`;
};

const until = async (pred: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('기다리다 지침');
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-runner-'));
  events = [];
  ctx = {
    appId: 'jiho.t',
    appDir: join(tmp, 'app'),
    dataDir: join(tmp, 'data'),
    settings: { 'refresh-sec': '5' },
    secrets: { 'api-key': 'sk-test' },
    env: { HACKMAC_POPUP: '/fake/popup' },
  };
  mkdirSync(join(ctx.appDir, 'scripts'), { recursive: true });
  mkdirSync(ctx.dataDir, { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const runner = (over: Partial<ConstructorParameters<typeof Runner>[0]> = {}) =>
  new Runner({ logsRoot: join(tmp, 'logs'), onEvent: (e) => events.push(e), ...over });

describe('runOnce', () => {
  it('환경변수를 주고, 로그 파일을 남기고, 결과를 돌려준다', async () => {
    const script = writeScript('env.sh', 'echo "app=$HACKMAC_APP_DIR data=$HACKMAC_DATA_DIR s=$HACKMAC_SETTING_REFRESH_SEC k=$HACKMAC_SECRET_API_KEY p=$HACKMAC_POPUP"; echo oops >&2; pwd');
    const r = await runner().runOnce(ctx, { kind: 'hotkey', script, key: 'x', name: 'x', description: 'x' });
    expect(r.success).toBe(true);
    expect(r.stdout).toContain(`app=${ctx.appDir} data=${ctx.dataDir} s=5 k=sk-test p=/fake/popup`);
    expect(r.stdout.trim().endsWith(ctx.dataDir)).toBe(true); // cwd는 데이터 폴더
    expect(r.stderr).toContain('oops');
    const log = readFileSync(r.logPath, 'utf8');
    expect(log).toContain('실행 시작: scripts/env.sh (hotkey)');
    expect(log).toContain('[stderr] oops');
    expect(log).toContain('종료 코드: 0');
    expect(r.logPath).toContain(join('logs', 'jiho.t'));
    expect(events.map((e) => e.kind)).toEqual(['run.start', 'run.end']);
  });

  it('실패 코드와 타임아웃을 보고한다', async () => {
    const r1 = await runner().runOnce(ctx, { kind: 'login', script: writeScript('fail.sh', 'exit 3'), name: 'x' });
    expect(r1).toMatchObject({ success: false, code: 3 });
    const r2 = await runner({ timeoutMs: 200 }).runOnce(ctx, { kind: 'login', script: writeScript('hang.sh', 'sleep 5'), name: 'x' });
    expect(r2.success).toBe(false);
    expect(r2.signal).toBe('SIGTERM');
  });
});

describe('resident', () => {
  it('죽으면 간격을 두고 다시 띄우고, 한도를 넘으면 포기한다', async () => {
    const r = runner({ backoffMs: [10, 20], crashLimit: 3, crashWindowMs: 10_000 });
    const script = writeScript('die.sh', 'echo HACKMAC_HEARTBEAT; exit 1');
    r.startResident(ctx, { kind: 'resident', script, heartbeat: 5 });
    await until(() => events.some((e) => e.kind === 'resident.gaveup'));
    const restarts = events.filter((e) => e.kind === 'resident.restart') as Extract<RunnerEvent, { kind: 'resident.restart' }>[];
    expect(restarts.map((e) => e.delayMs)).toEqual([10, 20]);
    expect(events.at(-1)).toMatchObject({ kind: 'resident.gaveup', crashes: 3 });
    expect(r.isResidentRunning('jiho.t')).toBe(false);
    // 세 번 돌았으니 로그 파일도 셋
    expect(readdirSync(join(tmp, 'logs', 'jiho.t', readdirSync(join(tmp, 'logs', 'jiho.t'))[0])).length).toBe(3);
  });

  it('생존 신호가 끊기면 끊고 다시 띄운다', async () => {
    const r = runner({ backoffMs: [10], crashLimit: 99 });
    // 첫 번만 신호를 보내고 멈춘다
    const script = writeScript('hang.sh', 'echo HACKMAC_HEARTBEAT; sleep 30');
    r.startResident(ctx, { kind: 'resident', script, heartbeat: 1 });
    await until(() => events.some((e) => e.kind === 'resident.hung'), 4000);
    await until(() => events.filter((e) => e.kind === 'run.start').length >= 2, 2000);
    await r.stopAll();
    expect(r.isResidentRunning('jiho.t')).toBe(false);
  });

  it('신호를 계속 보내면 살아 있고, stop하면 다시 띄우지 않는다', async () => {
    const r = runner({ backoffMs: [10] });
    const script = writeScript('ok.sh', 'while true; do echo HACKMAC_HEARTBEAT; sleep 0.2; done');
    r.startResident(ctx, { kind: 'resident', script, heartbeat: 1 });
    await new Promise((res) => setTimeout(res, 700));
    expect(r.isResidentRunning('jiho.t')).toBe(true);
    expect(events.some((e) => e.kind === 'resident.hung')).toBe(false);
    await r.stopResident('jiho.t');
    await new Promise((res) => setTimeout(res, 100));
    expect(events.filter((e) => e.kind === 'run.start').length).toBe(1);
    expect(events.some((e) => e.kind === 'resident.restart')).toBe(false);
  });
});
