import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ledger } from '../ledger/ledger.ts';
import type { RunnerEvent } from '../runner/runner.ts';
import { Maintainer, type Incident, type MaintainDeps, type PendingFix, type TeamResult } from './maintainer.ts';

let tmp: string;
let clock: Date;
let ledger: Ledger;
let log: string;
let busy: boolean;
let auto: boolean;
let teamResult: TeamResult;
let teamCalls: Incident[];
let applyResult: { ok: true; version: number } | { ok: false; error: string };
let applied: { dir: string; appId: string }[];
let ui: { advice: string[]; offers: PendingFix[]; applied: [PendingFix, number][]; unfixed: string[] };
let notices: string[];
let enabled: boolean;
let m: Maintainer;

const NIGHT = (h: number) => new Date(`2026-11-06T${String(h).padStart(2, '0')}:30:00`);
const runEnd = (over: Partial<Extract<RunnerEvent, { kind: 'run.end' }>> = {}): RunnerEvent => ({ kind: 'run.end', appId: 'a.app', script: 'scripts/x.sh', code: 1, signal: null, ms: 10, logPath: '/log', ...over });

const make = (over: Partial<MaintainDeps> = {}) =>
  new Maintainer({
    ledger, now: () => clock, pendingRoot: join(tmp, 'pending'),
    app: (id) => (id === 'a.app' ? { name: '미리알림 GTD', enabled } : null),
    readLog: () => log,
    team: async (inc, stage) => {
      teamCalls.push(inc);
      if (teamResult.ok) { mkdirSync(stage, { recursive: true }); writeFileSync(join(stage, 'manifest.json'), '{}'); }
      return teamResult;
    },
    applyFix: async (dir, appId) => { applied.push({ dir, appId }); return applyResult; },
    userBusy: () => busy, autoApply: () => auto,
    ui: {
      advise: (_a, _n, adv) => ui.advice.push(adv.title),
      offerFix: (f) => ui.offers.push(f),
      notifyApplied: (f, v) => ui.applied.push([f, v]),
      notifyUnfixed: (_a, _n, r) => ui.unfixed.push(r),
    },
    threadNotice: (_id, t) => notices.push(t),
    ...over,
  });

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5)); };
const kinds = () => ledger.read({ days: 2 }).map((e) => e.kind);

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-maintain-'));
  clock = NIGHT(14);
  ledger = new Ledger(join(tmp, 'ledger'), () => clock);
  log = 'zsh: command not found: jq';
  busy = false; auto = false; enabled = true;
  teamResult = { ok: true, summary: 'jq 대신 plutil로 읽게 바꿨어요.' };
  teamCalls = []; applied = []; notices = [];
  applyResult = { ok: true, version: 2 };
  ui = { advice: [], offers: [], applied: [], unfixed: [] };
  m = make();
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('Maintainer: 분류에 따라 안내만 하거나 팀을 부른다', () => {
  it('외부 원인(권한)은 에이전트를 부르지 않고 안내만 하며, 같은 안내는 쿨다운 안에 반복하지 않는다', async () => {
    log = 'execution error: Not authorized to send Apple events to Reminders. (-1743)';
    m.handle(runEnd());
    m.handle(runEnd());
    m.handle(runEnd());
    await settle();
    expect(ui.advice).toEqual(['미리알림 GTD에 권한이 필요해요']);
    expect(teamCalls).toEqual([]);
    clock = new Date(clock.getTime() + 7 * 3_600_000);
    m.handle(runEnd());
    expect(ui.advice).toHaveLength(2);
  });

  it('코드 원인은 한 번은 지켜보고(watching), 되풀이되면 팀을 부르고, 고친 것은 적용을 물어본다', async () => {
    m.handle(runEnd());
    await settle();
    expect(teamCalls).toEqual([]);
    expect(kinds()).toEqual(['maintain.failure', 'maintain.watching']);
    m.handle(runEnd());
    await settle();
    expect(teamCalls).toHaveLength(1);
    expect(teamCalls[0]).toMatchObject({ appId: 'a.app', appName: '미리알림 GTD', occurrences: 2, diag: { cause: 'code' } });
    expect(ui.offers).toHaveLength(1);
    expect(ui.offers[0]).toMatchObject({ appId: 'a.app', problem: '앱의 스크립트가 중간에 멈췄어요', summary: 'jq 대신 plutil로 읽게 바꿨어요.', announced: false });
    expect(m.pending('a.app')).toHaveLength(1);
    expect(m.pending('a.app')[0].announced).toBe(true);
    expect(applied).toEqual([]); // 자동 적용은 하지 않는다
    expect(kinds()).toContain('maintain.call');
    expect(kinds()).toContain('maintain.fixed');
  });

  it('서로 다른 실패는 합쳐 세지 않는다', async () => {
    log = 'zsh: command not found: jq';
    m.handle(runEnd());
    log = 'zsh: command not found: yq';
    m.handle(runEnd());
    await settle();
    expect(teamCalls).toEqual([]);
  });

  it('고친 것이 이미 대기 중이면 같은 앱을 또 부르지 않는다', async () => {
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(teamCalls).toHaveLength(1);
  });

  it('상주 앱이 포기하면 되풀이를 기다리지 않고 바로 부른다', async () => {
    m.handle({ kind: 'resident.gaveup', appId: 'a.app', crashes: 5, windowMs: 600_000 });
    await settle();
    expect(teamCalls).toHaveLength(1);
  });

  it('성공·일부러 끈 것·꺼진 앱·모르는 앱의 실행은 무시한다', async () => {
    m.handle(runEnd({ code: 0 }));
    m.handle(runEnd({ code: null, signal: 'SIGTERM', stopped: true }));
    m.handle(runEnd({ appId: 'other.app' }));
    enabled = false;
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(kinds()).toEqual([]);
    m.stop();
    enabled = true;
    m.handle(runEnd());
    expect(kinds()).toEqual([]);
  });
});

describe('Maintainer: 한도 보호', () => {
  const fixAndDismiss = async () => {
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    for (const f of m.pending()) m.dismiss(f.id);
  };

  it('같은 앱은 하루 3번까지, 그 뒤는 버리고 원장에 남긴다. 24시간이 지나면 다시 부른다', async () => {
    for (let i = 0; i < 3; i++) await fixAndDismiss();
    expect(teamCalls).toHaveLength(3);
    m.handle(runEnd());
    await settle();
    expect(teamCalls).toHaveLength(3);
    expect(kinds()).toContain('maintain.skipped');
    expect(m.history('a.app')[0].text).toBe('오늘은 이미 여러 번 시도해서 쉬어요');
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    await fixAndDismiss();
    expect(teamCalls).toHaveLength(4);
  });

  it('조용한 시간(밤)에는 팀 호출을 큐에 두고 아침 tick에서 부른다. 안내도 아침으로 미룬다', async () => {
    clock = NIGHT(23);
    log = 'execution error: Not authorized to send Apple events to Reminders. (-1743)';
    m.handle(runEnd());
    log = 'zsh: command not found: jq';
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(teamCalls).toEqual([]);
    expect(ui.advice).toEqual([]);
    m.tick();
    expect(teamCalls).toEqual([]);
    clock = NIGHT(7);
    m.tick();
    await settle();
    expect(ui.advice).toEqual(['미리알림 GTD에 권한이 필요해요']);
    expect(teamCalls).toHaveLength(1);
    expect(ui.offers).toHaveLength(1);
  });

  it('사용자가 작업실에서 개발 중이면 미루고, 끝나면 tick에서 부른다', async () => {
    busy = true;
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    m.tick();
    expect(teamCalls).toEqual([]);
    busy = false;
    m.tick();
    await settle();
    expect(teamCalls).toHaveLength(1);
  });

  it('같은 앱을 동시에 두 번 부르지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    m = make({ team: async (inc, stage) => { teamCalls.push(inc); await gate; mkdirSync(stage, { recursive: true }); writeFileSync(join(stage, 'm'), ''); return teamResult; } });
    m.handle(runEnd()); m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(teamCalls).toHaveLength(1);
    release();
    await settle();
    expect(teamCalls).toHaveLength(1);
  });
});

describe('Maintainer: 적용·거절·실패·자동 적용', () => {
  const makeFix = async () => {
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    return m.pending('a.app')[0];
  };

  it('[적용]: 보관된 패키지 폴더로 applyFix, 대기에서 지우고, 스레드에 날짜와 함께 남긴다', async () => {
    const fix = await makeFix();
    const r = await m.apply(fix.id);
    expect(r).toEqual({ ok: true, version: 2 });
    expect(applied).toEqual([{ dir: fix.dir, appId: 'a.app' }]);
    expect(m.pending()).toEqual([]);
    expect(existsSync(join(tmp, 'pending', fix.id))).toBe(false);
    expect(notices).toEqual(['11월 6일 자동 수정: 앱의 스크립트가 중간에 멈췄어요. jq 대신 plutil로 읽게 바꿨어요.']);
    expect(m.history('a.app').map((h) => h.text)).toEqual(['수정을 적용했어요', 'jq 대신 plutil로 읽게 바꿨어요.'].length ? expect.arrayContaining(['수정을 적용했어요']) : []);
  });

  it('적용이 실패하면 수정본을 그대로 둔다(다시 시도할 수 있다)', async () => {
    const fix = await makeFix();
    applyResult = { ok: false, error: '새 버전을 켜지 못해 되돌렸어요' };
    expect(await m.apply(fix.id)).toEqual({ ok: false, error: '새 버전을 켜지 못해 되돌렸어요' });
    expect(m.pending()).toHaveLength(1);
    expect(notices).toEqual([]);
    expect(await m.apply('없는-id')).toMatchObject({ ok: false });
  });

  it('[나중에]·거절은 수정본을 지우고 원장에 남긴다', async () => {
    const fix = await makeFix();
    expect(m.dismiss(fix.id)).toBe(true);
    expect(m.pending()).toEqual([]);
    expect(kinds()).toContain('maintain.dismissed');
    expect(m.dismiss(fix.id)).toBe(false);
  });

  it('자동 적용이 켜져 있으면 바로 적용하고 알린다(적용 후 알림은 간다)', async () => {
    auto = true;
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(applied).toHaveLength(1);
    expect(ui.offers).toEqual([]);
    expect(ui.applied).toHaveLength(1);
    expect(ui.applied[0][1]).toBe(2);
    expect(notices[0]).toContain('자동 수정(자동 적용)');
    expect(m.pending()).toEqual([]);
  });

  it('자동 적용이 실패하면 사용자에게 적용을 묻는 쪽으로 돌아간다', async () => {
    auto = true;
    applyResult = { ok: false, error: '켜지 못함' };
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(ui.offers).toHaveLength(1);
    expect(m.pending()).toHaveLength(1);
  });

  it('팀이 못 고치면 안내하고, 스레드에 남기고, 대기 폴더를 정리한다', async () => {
    teamResult = { ok: false, reason: '검증을 통과하지 못했어요' };
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(ui.unfixed).toEqual(['검증을 통과하지 못했어요']);
    expect(notices[0]).toBe('11월 6일 자동 수정을 시도했지만 고치지 못했어요: 검증을 통과하지 못했어요');
    expect(m.pending()).toEqual([]);
    expect(kinds()).toContain('maintain.failed');
  });

  it('팀이 던져도 감시자는 멈추지 않고 실패로 처리한다', async () => {
    m = make({ team: async () => { throw new Error('엔진 죽음'); } });
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    expect(ui.unfixed[0]).toContain('엔진 죽음');
  });

  it('팀이 못 고친 직후에는 새 실패가 와도 바로 다시 부르지 않고(쿨다운), 한 시간 뒤에는 다시 부른다', async () => {
    teamResult = { ok: false, reason: '못 고침' };
    m.handle(runEnd()); m.handle(runEnd());
    await settle();
    m.handle(runEnd());
    await settle();
    expect(teamCalls).toHaveLength(1);
    expect(m.history('a.app')[0].text).toBe('방금 고치지 못해서 잠시 쉬어요');
    clock = new Date(clock.getTime() + 61 * 60_000);
    m.handle(runEnd());
    await settle();
    expect(teamCalls).toHaveLength(2);
  });

  it('재시작 뒤에도 대기 수정본이 남아 있고, 아직 안 알린 것은 tick에서 알린다', async () => {
    clock = NIGHT(23);
    m.handle(runEnd()); m.handle(runEnd());
    clock = NIGHT(0);
    m.tick();
    await settle();
    expect(teamCalls).toEqual([]);
    clock = NIGHT(8);
    m.tick();
    await settle();
    const m2 = make();
    expect(m2.pending()).toHaveLength(1);
    expect(ui.offers).toHaveLength(1);
    const before = ui.offers.length;
    m2.tick();
    expect(ui.offers).toHaveLength(before); // 이미 알린 것은 다시 알리지 않는다
  });
});
