import { describe, expect, it } from 'vitest';
import { compareSemver, missingCapabilities, parseManifest, type AppManifest } from './manifest.ts';

const good = (): Record<string, unknown> => ({
  schema: 1,
  id: 'jiho.stock-ticker',
  version: '3',
  author: { name: 'jiho', signature: null },
  hackmac: { min: '2.0.0' },
  name: '주가 표시',
  icon: '📈',
  tagline: '메뉴바에서 내 종목을 바로 봐요',
  usage: ['{hotkey:add-symbol}로 종목을 추가하세요.'],
  triggers: [
    { kind: 'resident', script: 'scripts/ticker.sh', heartbeat: 60 },
    { kind: 'hotkey', script: 'scripts/add-symbol.sh', key: 'add-symbol', name: '종목 추가', description: '종목 코드를 입력해요.' },
    { kind: 'schedule', script: 'scripts/daily.sh', name: '장 마감 요약', cron: '0 16 * * 1-5' },
  ],
  capabilities: { tray: '>=1', popup: '>=1' },
  permissions: { network: ['finance.yahoo.com'], automation: [], accessibility: false, fullDiskAccess: false },
  settings: [{ key: 'symbols', label: '종목', type: 'list', default: [], required: true }],
  secrets: [{ key: 'api-key', label: 'API 키', required: false }],
  references: [],
});

const errorsOf = (m: Record<string, unknown>): string[] => {
  const r = parseManifest(m);
  return r.ok ? [] : r.errors;
};

describe('parseManifest', () => {
  it('올바른 선언을 통과시킨다', () => {
    const r = parseManifest(good());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.id).toBe('jiho.stock-ticker');
  });

  it('객체가 아니면 바로 실패', () => {
    expect(errorsOf(null as unknown as Record<string, unknown>)).toEqual(['manifest: 객체여야 함']);
  });

  it('모르는 schema 판은 막는다', () => {
    expect(errorsOf({ ...good(), schema: 2 })).toContainEqual(expect.stringMatching(/^schema:/));
  });

  it('id는 작성자.이름 꼴', () => {
    expect(errorsOf({ ...good(), id: 'gtd-reminders' })).toContainEqual(expect.stringMatching(/^id:/));
    expect(errorsOf({ ...good(), id: 'Jiho.App' })).toContainEqual(expect.stringMatching(/^id:/));
  });

  it('version은 정수 문자열', () => {
    expect(errorsOf({ ...good(), version: '1.0.0' })).toContainEqual(expect.stringMatching(/^version:/));
    expect(errorsOf({ ...good(), version: 3 })).toContainEqual(expect.stringMatching(/^version:/));
  });

  it('필수 카피만 요구하고 선택 카피는 없어도 된다', () => {
    const m = good();
    delete m.whatItIs;
    expect(errorsOf(m)).toEqual([]);
    expect(errorsOf({ ...good(), usage: undefined })).toContain('usage: 필수');
  });

  it('카피에 키 조합을 직접 쓰면 막는다', () => {
    expect(errorsOf({ ...good(), usage: ['업무 등록(Alt+1)을 누르세요'] })).toContainEqual(expect.stringMatching(/^usage\[0\]: 키 조합/));
    expect(errorsOf({ ...good(), tagline: 'Cmd+Shift+K 한 번이면' })).toContainEqual(expect.stringMatching(/^tagline: 키 조합/));
  });

  it('hotkey 트리거에 키 조합을 적으면 막는다', () => {
    const m = good();
    (m.triggers as Record<string, unknown>[])[1].hotkey = 'Alt+1';
    expect(errorsOf(m)).toContainEqual(expect.stringMatching(/triggers\[1\]\.hotkey/));
  });

  it('hotkey key 중복을 막는다', () => {
    const m = good();
    (m.triggers as unknown[]).push({ kind: 'hotkey', script: 'scripts/x.sh', key: 'add-symbol', name: 'x', description: 'y' });
    expect(errorsOf(m)).toContainEqual(expect.stringMatching(/key: 'add-symbol' 중복/));
  });

  it('resident는 앱당 하나', () => {
    const m = good();
    (m.triggers as unknown[]).push({ kind: 'resident', script: 'scripts/y.sh', heartbeat: 10 });
    expect(errorsOf(m)).toContainEqual(expect.stringMatching(/resident는 앱당 하나/));
  });

  it('schedule은 때를 정하는 방법 중 하나만', () => {
    const m = good();
    const t = (m.triggers as Record<string, unknown>[])[2];
    t.every = 60;
    expect(errorsOf(m)).toContainEqual(expect.stringMatching(/중 하나만/));
    delete t.cron;
    delete t.every;
    expect(errorsOf(m)).toContainEqual(expect.stringMatching(/중 하나만/));
  });

  it('schedule의 때를 설정으로 정할 수 있다: atSetting(time)·everyMinutesSetting(number)', () => {
    const m = good();
    (m.settings as unknown[]).push({ key: 'notify-at', label: '알림 시각', type: 'time', default: '09:00' }, { key: 'poll-min', label: '확인 간격(분)', type: 'number', default: 30 });
    const t = (m.triggers as Record<string, unknown>[])[2];
    delete t.cron;
    t.atSetting = 'notify-at';
    expect(errorsOf(m)).toEqual([]);
    delete t.atSetting;
    t.everyMinutesSetting = 'poll-min';
    expect(errorsOf(m)).toEqual([]);
  });

  it('schedule이 가리키는 설정이 없거나 종류가 틀리면 막는다', () => {
    const m = good();
    const t = (m.triggers as Record<string, unknown>[])[2];
    delete t.cron;
    t.atSetting = 'nope';
    expect(errorsOf(m)).toContainEqual(expect.stringMatching(/설정 'nope'가 settings에 없음/));
    (m.settings as unknown[]).push({ key: 'nope', label: 'x', type: 'string' });
    expect(errorsOf(m)).toContainEqual(expect.stringMatching(/time 종류여야 함/));
  });

  it('패키지 밖 경로를 막는다', () => {
    for (const script of ['/Users/x/a.sh', '../a.sh', 'scripts/../../a.sh', '~/a.sh']) {
      const m = good();
      (m.triggers as Record<string, unknown>[])[0].script = script;
      expect(errorsOf(m), script).toContainEqual(expect.stringMatching(/triggers\[0\]\.script/));
    }
  });

  it('능력 버전 범위는 >=N만', () => {
    expect(errorsOf({ ...good(), capabilities: { tray: '^1.0' } })).toContainEqual(expect.stringMatching(/^capabilities\.tray/));
  });

  it('choice 설정은 options가 필요하다', () => {
    expect(errorsOf({ ...good(), settings: [{ key: 'mode', label: '모드', type: 'choice' }] })).toContainEqual(expect.stringMatching(/options: choice면 필수/));
  });

  it('references는 repo·commit·borrowed·license가 필수', () => {
    expect(errorsOf({ ...good(), references: [{ repo: 'github.com/x/y' }] })).toEqual(
      expect.arrayContaining(['references[0].commit: 필수', 'references[0].borrowed: 필수', 'references[0].license: 필수']),
    );
  });

  it('여러 결함을 한 번에 모아 준다', () => {
    const errs = errorsOf({ ...good(), id: 'bad', version: 'x', name: '' });
    expect(errs.length).toBeGreaterThanOrEqual(3);
  });
});

describe('missingCapabilities', () => {
  const m = (parseManifest(good()) as { ok: true; manifest: AppManifest }).manifest;
  it('다 있으면 빈 목록', () => {
    expect(missingCapabilities(m, { tray: 1, popup: 2 })).toEqual([]);
  });
  it('없거나 낮으면 이름·요구·가진 것', () => {
    expect(missingCapabilities({ ...m, capabilities: { tray: '>=2', ai: '>=1' } }, { tray: 1 })).toEqual([
      { name: 'tray', need: '>=2', have: 1 },
      { name: 'ai', need: '>=1', have: null },
    ]);
  });
});

describe('compareSemver', () => {
  it('자리별로 비교', () => {
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
    expect(compareSemver('2.0.0', '2.1.0')).toBeLessThan(0);
    expect(compareSemver('10.0.0', '9.9.9')).toBeGreaterThan(0);
  });
});
