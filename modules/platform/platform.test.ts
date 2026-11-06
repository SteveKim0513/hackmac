import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretStore, type SecretCrypto } from '../secrets/secrets.ts';
import { Platform, type HotkeyPort } from './platform.ts';

const fakeCrypto = (available = true): SecretCrypto => ({ available: () => available, encrypt: (x) => Buffer.from(`enc:${x}`), decrypt: (c) => c.toString().slice(4) });

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
    expect(v.manifest!.usage[0]).toContain('(단축키)');
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
  describe('앱 설정 화면', () => {
    it('선언한 설정이 칸이 되고, 바꾼 값은 검증돼 저장되며 다음 실행부터 스크립트가 받는다', async () => {
      const p = platform();
      p.install(makePkg('a', { settings: [{ key: 'greeting', label: '인사', type: 'string', default: 'hi' }, { key: 'count', label: '횟수', type: 'number', default: 3 }] }));
      const v0 = p.appSettingsView('jiho.t');
      expect(v0).toMatchObject({ ok: true, missing: [] });
      if (!v0.ok) return;
      expect(v0.fields.map((f) => [f.key, f.value, f.changed])).toEqual([['greeting', 'hi', false], ['count', '3', false]]);

      const bad = await p.setAppSetting('jiho.t', 'count', 'abc');
      expect(bad).toEqual({ ok: false, error: '횟수: 숫자로 적어 주세요' });
      expect(await p.setAppSetting('jiho.t', 'nope', 'x')).toMatchObject({ ok: false });

      const r = await p.setAppSetting('jiho.t', 'greeting', 'hello');
      expect(r.ok && r.view.ok && r.view.fields[0]).toMatchObject({ value: 'hello', changed: true });
      p.enable('jiho.t');
      registered.get('Alt+1')!();
      await until(() => p.ledger.read({ kind: 'run.end' }).length === 1);
      expect(readFileSync(join(tmp, 'apps', 'jiho.t', 'data', 'ran.txt'), 'utf8')).toContain('ran hello');
    });

    it('빈 값을 보내면 기본값으로 되돌린다', async () => {
      const p = platform();
      p.install(makePkg('a'));
      await p.setAppSetting('jiho.t', 'greeting', 'yo');
      const r = await p.setAppSetting('jiho.t', 'greeting', '');
      expect(r.ok && r.view.ok && r.view.fields[0]).toMatchObject({ value: 'hi', changed: false });
    });

    it('스케줄 시각을 설정으로 정한다: 바꾸면 켜져 있는 앱이 새 시각으로 다시 붙는다', async () => {
      const p = platform();
      p.install(makePkg('a', {
        settings: [{ key: 'notify-at', label: '알림 시각', type: 'time', default: '16:00' }],
        triggers: [{ kind: 'schedule', script: 'scripts/a.sh', name: '알림', atSetting: 'notify-at' }],
      }));
      expect(p.enable('jiho.t')).toEqual({ ok: true, problems: [] });
      p.tick(new Date('2026-11-06T16:00:10')); // 기본 16:00에 한 번
      await until(() => p.ledger.read({ kind: 'run.end' }).length === 1);

      const bad = await p.setAppSetting('jiho.t', 'notify-at', '25:00');
      expect(bad.ok).toBe(false);
      const r = await p.setAppSetting('jiho.t', 'notify-at', '17:30');
      expect(r.ok).toBe(true);
      expect(p.isEnabled('jiho.t')).toBe(true);
      p.tick(new Date('2026-11-06T16:00:10')); // 예전 시각엔 안 돈다
      p.tick(new Date('2026-11-06T17:30:05'));
      await until(() => p.ledger.read({ kind: 'run.end' }).length === 2);
      await new Promise((x) => setTimeout(x, 100));
      expect(p.ledger.read({ kind: 'run.start' })).toHaveLength(2);
    });

    it('간격을 설정(분)으로 정한다', () => {
      const p = platform();
      p.install(makePkg('a', {
        settings: [{ key: 'poll', label: '확인 간격(분)', type: 'number', default: 0 }],
        triggers: [{ kind: 'schedule', script: 'scripts/a.sh', name: '확인', everyMinutesSetting: 'poll' }],
      }));
      const e = p.enable('jiho.t');
      expect(e).toMatchObject({ ok: true });
      expect(e.ok && e.problems[0]).toMatch(/1분 이상/);
    });

    it('비밀값: 값은 화면에 돌려주지 않고 스크립트 env로만 간다. 필수인데 없으면 켜지지 않는다', async () => {
      const secrets = new SecretStore(join(tmp, 'secrets.json'), fakeCrypto());
      const p = platform({ secrets });
      const dir = makePkg('a', { secrets: [{ key: 'api-key', label: 'API 키', required: true }] });
      writeFileSync(join(dir, 'scripts', 'a.sh'), '#!/bin/zsh\necho "key=$HACKMAC_SECRET_API_KEY" > "$HACKMAC_DATA_DIR/ran.txt"\n');
      p.install(dir);
      expect(p.enable('jiho.t')).toEqual({ ok: false, reason: '설정 필요: API 키' });
      const before = p.appSettingsView('jiho.t');
      expect(before.ok && before.missing).toEqual(['API 키']);

      const r = await p.setAppSecret('jiho.t', 'api-key', 'sk-TOP-SECRET');
      expect(r.ok && r.view.ok && r.view.secrets[0]).toEqual({ key: 'api-key', label: 'API 키', required: true, isSet: true });
      expect(JSON.stringify(r)).not.toContain('TOP-SECRET');
      expect(JSON.stringify(p.ledger.read())).not.toContain('TOP-SECRET');
      expect(JSON.stringify(p.settings.get())).not.toContain('TOP-SECRET');

      expect(p.enable('jiho.t').ok).toBe(true);
      registered.get('Alt+1')!();
      await until(() => p.ledger.read({ kind: 'run.end' }).length === 1);
      expect(readFileSync(join(tmp, 'apps', 'jiho.t', 'data', 'ran.txt'), 'utf8')).toContain('key=sk-TOP-SECRET');

      await p.setAppSecret('jiho.t', 'api-key', null);
      const after = p.appSettingsView('jiho.t');
      expect(after.ok && after.secrets[0]!.isSet).toBe(false);
    });

    it('비밀값 보관소를 쓸 수 없으면 저장을 거절한다', async () => {
      const p = platform({ secrets: new SecretStore(join(tmp, 'secrets.json'), fakeCrypto(false)) });
      p.install(makePkg('a', { secrets: [{ key: 'api-key', label: 'API 키' }] }));
      expect((await p.setAppSecret('jiho.t', 'api-key', 'x')).ok).toBe(false);
    });
  });
});
