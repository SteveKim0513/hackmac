import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askOnce } from '../conversation/once.ts';
import { Platform, type HotkeyPort } from '../platform/platform.ts';
import { classify } from './classify.ts';
import { Maintainer, type Incident, type PendingFix } from './maintainer.ts';
import { createTeam, type TeamDeps } from './team.ts';

const CWD = process.cwd();
const FIXTURE = join(CWD, 'modules', 'conversation', 'fixtures', 'fake-claude.mjs');
let tmp: string;

const manifest = (over: Record<string, unknown> = {}) => ({
  schema: 1, id: 'a.app', version: '1', author: { name: 'a', signature: null }, hackmac: { min: '2.0.0' },
  name: '시험 앱', icon: '🧪', tagline: '{hotkey:go} 누르면', usage: ['{hotkey:go}'],
  triggers: [{ kind: 'hotkey', script: 'scripts/x.sh', key: 'go', name: '실행', description: '실행한다' }],
  capabilities: {}, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false }, settings: [], secrets: [], references: [], ...over,
});

const writePkg = (dir: string, script = '#!/bin/zsh\nnonexistent-tool --go\n'): string => {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest()));
  writeFileSync(join(dir, 'scripts', 'x.sh'), script);
  return dir;
};

const incident = (evidence = 'zsh: command not found: jq'): Incident => ({
  fixId: 'fix-1', appId: 'a.app', appName: '시험 앱', occurrences: 2, at: '2026-11-06T16:00:00.000Z',
  diag: classify({ code: 127, signal: null, log: evidence, appName: '시험 앱' })!, log: `...\n${evidence}\n종료 코드: 127`,
});

const teamDeps = (over: Partial<TeamDeps> = {}): TeamDeps => ({
  currentPackage: () => join(tmp, 'installed'),
  installedVersion: () => '1',
  gate: { capabilities: {}, realHome: homedir(), popupStub: join(CWD, 'resources', 'bin', 'hackmac-popup-stub') },
  engine: () => ({ vendor: 'claude', bin: process.execPath, env: { ...process.env } as Record<string, string> }),
  agentPaths: { buildWrapper: join(CWD, 'resources', 'bin', 'hackmac-build'), buildClientJs: join(CWD, 'resources', 'bin', 'hackmac-build-client.cjs'), electronBin: process.execPath, docs: [] },
  instructions: '유지보수 팀 지시',
  ledgerText: () => '(원장)',
  memoryText: () => '(기억)',
  runAgent: (v, o, p, t) => askOnce(v, { ...o, prefixArgs: [FIXTURE] }, p, t),
  workRoot: join(tmp, 'work'),
  timeoutMs: 60_000,
  ...over,
});

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-team-'));
  writePkg(join(tmp, 'installed'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('createTeam(가짜 엔진)', () => {
  it('고쳐서 검증을 통과하면 보관 폴더에 둔다. 설치된 원본은 그대로이고 작업 폴더는 지운다', async () => {
    const stage = join(tmp, 'pending', 'fix-1', 'app');
    const r = await createTeam(teamDeps())(incident(), stage);
    expect(r).toEqual({ ok: true, summary: '명령이 없어서 멈추던 부분을 고쳤고, 그 경우를 시험으로 확인했어요.' });
    expect(JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8')).version).toBe('2');
    expect(readFileSync(join(stage, 'scripts', 'x.sh'), 'utf8')).toContain('고친 스크립트');
    expect(existsSync(join(stage, 'checks', 'R1-fixed.sh'))).toBe(true);
    // 원본은 건드리지 않았다
    expect(readFileSync(join(tmp, 'installed', 'scripts', 'x.sh'), 'utf8')).toContain('nonexistent-tool');
    expect(JSON.parse(readFileSync(join(tmp, 'installed', 'manifest.json'), 'utf8')).version).toBe('1');
    expect(readdirSync(join(tmp, 'work'))).toEqual([]);
  }, 60_000);

  it('코드로 고칠 수 없다고 답하면 수정본 없이 이유만 돌려준다', async () => {
    const stage = join(tmp, 'pending', 'fix-1', 'app');
    const r = await createTeam(teamDeps())(incident('UNFIXABLE 외부 원인'), stage);
    expect(r).toEqual({ ok: false, reason: '외부 원인이라 앱을 고쳐도 낫지 않아요.' });
    expect(existsSync(stage)).toBe(false);
  }, 60_000);

  it('검증을 통과하지 못하는 수정본은 보관하지 않는다(게이트가 그대로 막는다)', async () => {
    const stage = join(tmp, 'pending', 'fix-1', 'app');
    const r = await createTeam(teamDeps())(incident('BADFIX zsh: command not found: jq'), stage);
    expect(r).toEqual({ ok: false, reason: '수정본이 검증을 통과하지 못했어요' });
    expect(existsSync(stage)).toBe(false);
    expect(readdirSync(join(tmp, 'work'))).toEqual([]);
  }, 60_000);

  it('엔진이 없거나 현재 버전이 없거나 엔진이 죽으면 이유를 돌려준다', async () => {
    const stage = join(tmp, 'pending', 'fix-1', 'app');
    expect(await createTeam(teamDeps({ engine: () => null }))(incident(), stage)).toMatchObject({ ok: false, reason: expect.stringContaining('로그인') });
    expect(await createTeam(teamDeps({ currentPackage: () => null }))(incident(), stage)).toMatchObject({ ok: false, reason: expect.stringContaining('현재 버전') });
    const dead = await createTeam(teamDeps({ runAgent: async () => { throw new Error('엔진이 끝남'); } }))(incident(), stage);
    expect(dead).toMatchObject({ ok: false, reason: expect.stringContaining('엔진이 끝남') });
    expect(readdirSync(join(tmp, 'work'))).toEqual([]);
  }, 60_000);

  it('팀에게 주는 입력: 사건·로그·원장·기억 파일과 앱 복사본', async () => {
    let seen: Record<string, string> = {};
    const r = await createTeam(teamDeps({
      runAgent: async (_v, o) => {
        const read = (f: string) => readFileSync(join(o.cwd, f), 'utf8');
        seen = { incident: read('context/incident.md'), log: read('context/log.txt'), ledger: read('context/ledger.txt'), memory: read('context/memory.txt'), script: read('app/scripts/x.sh'), instr: o.instructions ?? '', hasBuild: o.env.HACKMAC_BUILD ?? '' };
        return '고칠 수 없음: 시험';
      },
    }))(incident(), join(tmp, 'pending', 'fix-1', 'app'));
    expect(r.ok).toBe(false);
    expect(seen.incident).toContain('원인 분류(코드가 판정): code');
    expect(seen.incident).toContain('하루 안에 같은 실패가 2번');
    expect(seen.log).toContain('command not found: jq');
    expect(seen.ledger).toBe('(원장)');
    expect(seen.memory).toBe('(기억)');
    expect(seen.script).toContain('nonexistent-tool');
    expect(seen.instr).toBe('유지보수 팀 지시');
    expect(seen.hasBuild).toContain('hackmac-build');
  }, 60_000);
});

describe('통합: 실패 → 감시 → 수정 → 적용 → 고쳐진 앱 실행', () => {
  const hotkeys = new Map<string, () => void>();
  const port: HotkeyPort = { register: (a, cb) => { hotkeys.set(a, cb); return true; }, unregister: (a) => void hotkeys.delete(a) };
  const until = async (pred: () => boolean, ms = 30_000) => {
    const t0 = Date.now();
    while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 25)); }
  };

  it('깨진 앱을 두 번 실행하면 팀이 고치고, 적용하면 같은 단축키로 고쳐진 앱이 돈다', async () => {
    const now = () => new Date('2026-11-06T16:00:00');
    const p = new Platform({
      paths: { apps: join(tmp, 'apps'), logs: join(tmp, 'logs'), ledger: join(tmp, 'ledger'), settings: join(tmp, 'settings.json') },
      capabilities: {}, capabilityEnv: () => ({}), hotkeys: port, hackmacVersion: '2.0.0', now,
    });
    expect(p.install(join(tmp, 'installed')).ok).toBe(true);
    expect(p.enable('a.app')).toEqual({ ok: true, problems: [] });
    const accel = [...hotkeys.keys()][0];

    const offers: PendingFix[] = [];
    const readLog = (_id: string, logPath: string | null) => (logPath ? readFileSync(logPath, 'utf8') : '');
    const m = new Maintainer({
      ledger: p.ledger, now, pendingRoot: join(tmp, 'pending'),
      app: (id) => { const v = p.list().find((x) => x.id === id); return v?.manifest ? { name: v.manifest.name, enabled: v.enabled } : null; },
      readLog,
      team: createTeam(teamDeps({ currentPackage: (id) => p.store.currentDir(id), installedVersion: (id) => { const d = p.store.currentDir(id); return d ? String(JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')).version) : null; } })),
      applyFix: (dir, id) => p.applyFix(dir, id),
      userBusy: () => false, autoApply: () => false,
      ui: { advise: () => {}, offerFix: (f) => offers.push(f), notifyApplied: () => {}, notifyUnfixed: () => {} },
      threadNotice: () => {},
    });
    p.subscribe((e) => m.handle(e));

    const press = async (n: number) => {
      hotkeys.get(accel)!();
      await until(() => p.ledger.read({ kind: 'run.end' }).length >= n);
    };
    await press(1);
    expect(m.pending()).toEqual([]);
    await press(2);
    await until(() => offers.length === 1);
    expect(offers[0]).toMatchObject({ appId: 'a.app', cause: 'code' });
    expect(p.store.get('a.app')!.versions).toEqual([1]); // 아직 적용 전: 옛 버전이 그대로 돈다

    const r = await m.apply(offers[0].id);
    expect(r).toEqual({ ok: true, version: 2 });
    expect(p.store.get('a.app')!.current).toBe(2);
    expect(p.isEnabled('a.app')).toBe(true);
    expect([...hotkeys.keys()]).toEqual([accel]); // 단축키 자리 그대로

    hotkeys.get(accel)!();
    await until(() => p.ledger.read({ kind: 'run.end' }).length >= 3);
    const last = p.ledger.read({ kind: 'run.end' }).at(-1)!;
    expect(last.code).toBe(0);
    expect(readFileSync(last.logPath as string, 'utf8')).toContain('판단: 고친 스크립트');
    expect(p.ledger.read().map((e) => e.kind).filter((k) => k.startsWith('maintain.'))).toEqual(expect.arrayContaining(['maintain.failure', 'maintain.call', 'maintain.fixed', 'maintain.applied']));
    await p.shutdown();
  }, 90_000);

  it('applyFix: 새 버전을 켜지 못하면 옛 버전으로 되돌려 다시 켠다', async () => {
    const p = new Platform({
      paths: { apps: join(tmp, 'apps'), logs: join(tmp, 'logs'), ledger: join(tmp, 'ledger'), settings: join(tmp, 'settings.json') },
      capabilities: {}, capabilityEnv: () => ({}), hotkeys: port, hackmacVersion: '2.0.0', now: () => new Date('2026-11-06T16:00:00'),
    });
    p.install(join(tmp, 'installed'));
    p.enable('a.app');
    // 새 버전은 필수 설정이 있어 켜지지 않는다
    const bad = writePkg(join(tmp, 'bad'));
    writeFileSync(join(bad, 'manifest.json'), JSON.stringify(manifest({ version: '2', settings: [{ key: 'k', label: '필수', type: 'string', required: true }] })));
    const r = await p.applyFix(bad, 'a.app');
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('되돌렸어요') });
    expect(p.store.get('a.app')!.current).toBe(1);
    expect(p.isEnabled('a.app')).toBe(true);
    expect(p.ledger.read().map((e) => e.kind)).toContain('app.fix.rolledback');
    // id가 다른 수정본은 거절하고 현재 버전을 그대로 둔다
    const other = writePkg(join(tmp, 'other'));
    writeFileSync(join(other, 'manifest.json'), JSON.stringify(manifest({ id: 'a.other', version: '9' })));
    expect(await p.applyFix(other, 'a.app')).toMatchObject({ ok: false, error: expect.stringContaining('id') });
    expect(p.store.get('a.app')!.current).toBe(1);
    await p.shutdown();
  }, 30_000);
});
