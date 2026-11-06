import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Platform, type HotkeyPort } from './platform.ts';

const GTD_SERVICES = join(process.cwd(), 'resources', 'services');

let tmp: string;
let registered: Map<string, () => void>;
let hotkeys: HotkeyPort & { refuse: Set<string> };

const makePkg = (name: string, over: Record<string, unknown> = {}): string => {
  const dir = join(tmp, 'pkgs', name);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'a.sh'), '#!/bin/zsh\necho "ran $HACKMAC_SETTING_GREETING" > "$HACKMAC_DATA_DIR/ran.txt"\n');
  writeFileSync(join(dir, 'scripts', 'r.sh'), '#!/bin/zsh\nwhile true; do echo HACKMAC_HEARTBEAT; sleep 0.2; done\n');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    schema: 1, id: 'jiho.t', version: '1', author: { name: 'jiho', signature: null }, hackmac: { min: '2.0.0' },
    name: 't', icon: 'x', tagline: '{hotkey:go} 누르면', usage: ['{hotkey:go}'],
    triggers: [{ kind: 'hotkey', script: 'scripts/a.sh', key: 'go', name: '가', description: 'd' }],
    capabilities: { popup: '>=1' }, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false },
    settings: [{ key: 'greeting', label: '인사', type: 'string', default: 'hi' }], secrets: [], references: [], ...over,
  }));
  return dir;
};

const platform = (over: Partial<ConstructorParameters<typeof Platform>[0]> = {}) =>
  new Platform({
    paths: { apps: join(tmp, 'apps'), logs: join(tmp, 'logs'), ledger: join(tmp, 'ledger'), settings: join(tmp, 'settings.json') },
    capabilities: { popup: 1 },
    capabilityEnv: () => ({ HACKMAC_POPUP: '/fake' }),
    hotkeys,
    hackmacVersion: '2.0.0',
    now: () => new Date('2026-11-06T16:00:00'),
    runner: { backoffMs: [10] },
    ...over,
  });

const until = async (pred: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 20)); }
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-platform-'));
  registered = new Map();
  hotkeys = {
    refuse: new Set(),
    register: (a, cb) => { if (hotkeys.refuse.has(a)) return false; registered.set(a, cb); return true; },
    unregister: (a) => void registered.delete(a),
  };
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('Platform', () => {
  it('번들 v1 서비스를 기본 앱으로 넣고, 두 번째는 건너뛴다', () => {
    const p = platform();
    expect(p.installBundledV1(GTD_SERVICES)).toEqual({ installed: ['hackmac.gtd-reminders'], errors: [] });
    expect(p.installBundledV1(GTD_SERVICES)).toEqual({ installed: [], errors: [] });
    const v = p.list()[0];
    expect(v).toMatchObject({ id: 'hackmac.gtd-reminders', version: 1, enabled: false });
    expect(v.hotkeys.map((h) => h.key)).toContain('register');
    expect(v.manifest!.usage[0]).toContain('(미배정)');
  });

  it('켜면 자리를 배정해 단축키를 등록하고, 누르면 스크립트가 env와 함께 돈다', async () => {
    const p = platform();
    p.install(makePkg('a'));
    expect(p.enable('jiho.t')).toEqual({ ok: true, problems: [] });
    expect([...registered.keys()]).toEqual(['Alt+1']);
    expect(p.list()[0].manifest!.tagline).toBe('Alt+1 누르면');
    expect(p.settings.get()).toMatchObject({ enabled: ['jiho.t'], hotkeys: { 'jiho.t/go': 'Alt+1' } });
    registered.get('Alt+1')!();
    const ran = join(tmp, 'apps', 'jiho.t', 'data', 'ran.txt');
    await until(() => p.ledger.read({ kind: 'run.end' }).length === 1);
    expect(readFileSync(ran, 'utf8')).toContain('ran hi');
    expect(p.ledger.read().map((e) => e.kind)).toEqual(['app.installed', 'app.enabled', 'run.start', 'run.end']);
  });

  it('단축키 실행 중 같은 키를 다시 누르면 버리고, 앞뒤 훅을 부른다', async () => {
    const seen: string[] = [];
    const p = platform({ hooks: { onHotkeyRunStart: (id) => seen.push(`start:${id}`), onHotkeyRunEnd: (id, _t, r) => seen.push(`end:${id}:${r.success}`) } });
    p.install(makePkg('a'));
    p.enable('jiho.t');
    registered.get('Alt+1')!();
    registered.get('Alt+1')!();
    await until(() => seen.length === 2);
    expect(seen).toEqual(['start:jiho.t', 'end:jiho.t:true']);
    expect(p.ledger.read({ kind: 'run.start' })).toHaveLength(1);
    registered.get('Alt+1')!();
    await until(() => seen.length === 4);
  });

  it('끄면 자리를 돌려주고 기억해 둔다. 다시 켜면 같은 자리', async () => {
    const p = platform();
    p.install(makePkg('a'));
    p.enable('jiho.t');
    await p.disable('jiho.t');
    expect(registered.size).toBe(0);
    expect(p.settings.get()).toMatchObject({ enabled: [], hotkeys: {}, hotkeysPrevious: { 'jiho.t/go': 'Alt+1' } });
    p.enable('jiho.t');
    expect([...registered.keys()]).toEqual(['Alt+1']);
  });

  it('다른 프로그램이 쥔 단축키는 problems로 보고하되 앱은 켜진다', () => {
    hotkeys.refuse.add('Alt+1');
    const p = platform();
    p.install(makePkg('a'));
    const r = p.enable('jiho.t');
    expect(r).toMatchObject({ ok: true, problems: [expect.stringMatching(/Alt\+1를 다른 프로그램이/)] });
    expect(p.list()[0].problems).toHaveLength(1);
  });

  it('required 설정값이 없으면 켜지지 않는다', () => {
    const p = platform();
    p.install(makePkg('a', { settings: [{ key: 'symbol', label: '종목', type: 'string', required: true }] }));
    expect(p.enable('jiho.t')).toEqual({ ok: false, reason: '설정 필요: 종목' });
    p.settings.update({ appSettings: { 'jiho.t': { symbol: 'AAPL' } } });
    expect(p.enable('jiho.t').ok).toBe(true);
  });

  it('상주 트리거는 켜면 돌고 끄면 멈춘다', async () => {
    const p = platform();
    p.install(makePkg('a', { triggers: [{ kind: 'resident', script: 'scripts/r.sh', heartbeat: 2 }] }));
    p.enable('jiho.t');
    await until(() => p.runner.isResidentRunning('jiho.t'));
    await p.disable('jiho.t');
    expect(p.runner.isResidentRunning('jiho.t')).toBe(false);
  });

  it('스케줄은 tick에서 그 분에 한 번만 돈다', async () => {
    const p = platform();
    p.install(makePkg('a', { triggers: [{ kind: 'schedule', script: 'scripts/a.sh', name: 's', cron: '0 16 * * 5' }] }));
    p.enable('jiho.t');
    p.tick(new Date('2026-11-06T16:00:10'));
    p.tick(new Date('2026-11-06T16:00:40'));
    p.tick(new Date('2026-11-06T16:01:00'));
    await until(() => p.ledger.read({ kind: 'run.end' }).length >= 1);
    await new Promise((r) => setTimeout(r, 100));
    expect(p.ledger.read({ kind: 'run.start' })).toHaveLength(1);
  });

  it('restore는 enabled 목록대로 켜고 실패를 보고한다', async () => {
    const p = platform();
    p.install(makePkg('a'));
    p.enable('jiho.t');
    p.settings.update({ enabled: ['jiho.t', 'ghost.app'] });
    await p.shutdown();
    registered.clear();
    const p2 = platform();
    expect(p2.restore()).toEqual({ enabled: ['jiho.t'], failed: [{ id: 'ghost.app', reason: '설치돼 있지 않거나 현재 버전이 없음' }] });
    expect([...registered.keys()]).toEqual(['Alt+1']);
  });
});
