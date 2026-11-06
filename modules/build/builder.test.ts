import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Builder } from './builder.ts';
import { parseVerdict } from './evaluate.ts';
import { reduce, validateAgentEvent, type BuildState } from './progress.ts';

const CLIENT = join(process.cwd(), 'resources', 'bin', 'hackmac-build-client.cjs');
const STUB = join(process.cwd(), 'resources', 'bin', 'hackmac-popup-stub');
let tmp: string;
let work: string;
let builder: Builder;
let installs: string[];
let states: BuildState[];
let verdictJson: string;

/** 에이전트가 하는 것과 똑같이 CLI를 부른다 */
const cli = (...args: string[]): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, [CLIENT, ...args], { env: { ...process.env, HACKMAC_BUILD_DIR: join(work, '.hackmac') } });
    let out = '';
    c.stdout.on('data', (b) => (out += b));
    c.stderr.on('data', (b) => (out += b));
    c.on('close', (code) => resolve({ code, out: out.trim() }));
  });

const writeApp = (checkBody = '#!/bin/zsh\n[[ -n "$HACKMAC_APP_DIR" ]]\n') => {
  const app = join(work, 'app');
  mkdirSync(join(app, 'scripts'), { recursive: true });
  mkdirSync(join(app, 'checks'), { recursive: true });
  writeFileSync(join(app, 'manifest.json'), JSON.stringify({
    schema: 1, id: 'my.today', version: '1', author: { name: 'me', signature: null }, hackmac: { min: '2.0.0' },
    name: '오늘 날짜', icon: '📅', tagline: '{hotkey:show} 누르면 오늘 날짜', usage: ['{hotkey:show}'],
    triggers: [{ kind: 'hotkey', script: 'scripts/show.sh', key: 'show', name: '날짜 보기', description: '알림으로 오늘 날짜를 보여 준다' }],
    capabilities: {}, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false }, settings: [], secrets: [], references: [],
  }));
  writeFileSync(join(app, 'scripts', 'show.sh'), '#!/bin/zsh\nd=$(date +%F)\necho "판단: 날짜=$d"\nosascript -e "display notification \\"$d\\" with title \\"오늘\\""\n');
  writeFileSync(join(app, 'checks', 'R1-date.sh'), checkBody);
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-builder-'));
  work = join(tmp, 'work');
  mkdirSync(work);
  installs = [];
  states = [];
  verdictJson = '{"kind":"possible","summary":"기본 도구로 바로 만들 수 있어요","conditions":[],"reasons":[]}';
  builder = new Builder({
    workDir: work,
    progressFile: join(tmp, 'progress.jsonl'),
    gate: { capabilities: { popup: 1 }, realHome: homedir(), popupStub: STUB },
    evaluator: () => ({ ask: async () => `여기 결과입니다\n${verdictJson}`, by: 'codex' }),
    evaluateContext: { capabilities: '능력 목록', macosVersion: '26.0' },
    installedVersion: () => null,
    install: (dir) => { installs.push(dir); return { ok: true, id: 'my.today', version: 1 }; },
    onState: (s) => states.push(s),
  });
  builder.start();
});
afterEach(() => {
  builder.stop();
  rmSync(tmp, { recursive: true, force: true });
});

describe('progress', () => {
  it('에이전트 사건은 따져 읽는다', () => {
    expect(validateAgentEvent({ type: 'req', id: 'X1', text: 'a' })).toMatchObject({ ok: false });
    expect(validateAgentEvent({ type: 'step', step: 6 })).toMatchObject({ ok: false, error: expect.stringContaining('submit') });
    expect(validateAgentEvent({ type: 'req', id: 'R2', text: '  알림  ', manual: '사람이 봐야 함' })).toEqual({ ok: true, event: { type: 'req', id: 'R2', text: '알림', manual: '사람이 봐야 함' } });
    expect(validateAgentEvent({ type: 'hack' })).toMatchObject({ ok: false });
  });

  it('기록을 접으면 상태가 된다. 근거 2개 미만 실패는 세지 않는다', () => {
    const s = reduce([
      { type: 'req', id: 'R2', text: 'b' }, { type: 'req', id: 'R1', text: 'a' }, { type: 'req', id: 'R1', text: 'a2', manual: '사람' },
      { type: 'step', step: 3, now: '만드는 중' },
      { type: 'gate', ok: false, requirements: { R2: 'failed' }, summary: '검증 실패' },
      { type: 'fail', failure: 'external', needed: '유료 키', evidence: ['시도'] },
    ]);
    expect(s.requirements).toEqual([{ id: 'R1', text: 'a2', manual: '사람', status: 'manual' }, { id: 'R2', text: 'b', manual: null, status: 'failed' }]);
    expect(s).toMatchObject({ step: 3, now: '만드는 중', gate: { ok: false } });
    expect(s.failures[0].counted).toBe(false);
  });

  it('평가 JSON은 앞뒤 잡글과 코드 블록을 견디고, 틀린 모양은 null', () => {
    expect(parseVerdict('```json\n{"kind":"conditional","summary":"키가 필요","conditions":["API 키"],"reasons":[]}\n```', 'claude')).toEqual({ kind: 'conditional', summary: '키가 필요', conditions: ['API 키'], reasons: [], by: 'claude' });
    expect(parseVerdict('{"kind":"maybe","summary":"x"}', 'c')).toBeNull();
    expect(parseVerdict('답 없음', 'c')).toBeNull();
  });
});

describe('Builder(진짜 hackmac-build 클라이언트로)', () => {
  it('요구사항 → 평가 → 검증 실패 → 고쳐서 submit → 설치', async () => {
    expect(await cli('req', 'R1', '단축키를', '누르면', '오늘', '날짜를', '알림으로')).toEqual({ code: 0, out: '기록함' });
    expect(await cli('step', '2', '평가', '받는', '중')).toMatchObject({ code: 0 });

    const submitEarly = await cli('submit');
    expect(submitEarly).toMatchObject({ code: 1, out: expect.stringContaining('가능성 평가를 먼저') });

    const ev = await cli('evaluate');
    expect(ev.code).toBe(0);
    expect(ev.out).toContain('가능성 평가: 가능 (평가: codex)');

    const noApp = await cli('verify');
    expect(noApp).toMatchObject({ code: 1, out: expect.stringContaining('manifest.json이 없음') });

    writeApp('#!/bin/zsh\nexit 1\n');
    const bad = await cli('submit');
    expect(bad.code).toBe(1);
    expect(bad.out).toContain('설치하지 않음');
    expect(installs).toEqual([]);

    writeApp();
    const ok = await cli('submit');
    expect(ok).toMatchObject({ code: 0, out: expect.stringContaining('설치함: my.today') });
    expect(installs).toEqual([join(work, 'app')]);

    const s = builder.state();
    expect(s).toMatchObject({ step: 6, installed: { appId: 'my.today' }, requirements: [{ id: 'R1', status: 'passed' }] });
    expect(states.length).toBeGreaterThan(3);
    // 진행 기록은 작업 폴더 밖에 있다
    expect(existsSync(join(tmp, 'progress.jsonl'))).toBe(true);
    expect(existsSync(join(work, '.hackmac', 'progress.jsonl'))).toBe(false);
  }, 30_000);

  it('불가능 평가면 submit을 막는다', async () => {
    verdictJson = '{"kind":"impossible","summary":"macOS가 막아요","conditions":[],"reasons":["SIP"]}';
    await cli('req', 'R1', '시스템 파일 고치기');
    await cli('evaluate');
    writeApp();
    expect(await cli('submit')).toMatchObject({ code: 1, out: expect.stringContaining('불가능') });
    expect(installs).toEqual([]);
  }, 30_000);

  it('틀린 사건은 이유와 함께 거절하고, 모르는 명령은 사용법을 보인다', async () => {
    expect(await cli('req', 'one', '뭔가')).toEqual({ code: 1, out: '요구사항 번호는 R1, R2 … 형식' });
    expect(await cli('step', '6')).toMatchObject({ code: 1 });
    expect(await cli('fail', '--type', 'macos', '--needed', '화면 녹화 권한', '--evidence', '시도1', '--evidence', '문서')).toMatchObject({ code: 0 });
    expect(builder.state().failures[0]).toMatchObject({ failure: 'macos', counted: true });
    expect(await cli('nope')).toMatchObject({ code: 2, out: expect.stringContaining('사용법') });
    expect(await cli('status')).toMatchObject({ code: 0, out: expect.stringContaining('단계 1 요구 정리') });
  }, 30_000);

});
