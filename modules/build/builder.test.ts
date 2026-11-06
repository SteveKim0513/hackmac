import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Builder } from './builder.ts';
import type { PipelineOutcome } from './pipeline.ts';
import type { RoleId } from './roles.ts';
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
/** 가짜 담당들이 하는 일을 시험마다 바꾼다 */
let fake: { testerBodies: string[]; auditJson: (round: number) => string; testerTouchesScript: boolean; delayMs: number };
let roleCalls: { role: RoleId; prompt: string }[];
let learned: string[];
let ended: Promise<{ o: PipelineOutcome; text: string }>;
let endResolve: (v: { o: PipelineOutcome; text: string }) => void;

/** 에이전트가 하는 것과 똑같이 CLI를 부른다 */
const cli = (...args: string[]): Promise<{ code: number | null; out: string }> =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, [CLIENT, ...args], { env: { ...process.env, HACKMAC_BUILD_DIR: join(work, '.hackmac') } });
    let out = '';
    c.stdout.on('data', (b) => (out += b));
    c.stderr.on('data', (b) => (out += b));
    c.on('close', (code) => resolve({ code, out: out.trim() }));
  });

const writeApp = (checkBody = '#!/bin/zsh\n[[ -n "$HACKMAC_APP_DIR" ]]\n', withCheck = true) => {
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
  if (withCheck) writeFileSync(join(app, 'checks', 'R1-date.sh'), checkBody);
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-builder-'));
  work = join(tmp, 'work');
  mkdirSync(work);
  installs = [];
  states = [];
  verdictJson = '{"kind":"possible","summary":"기본 도구로 바로 만들 수 있어요","conditions":[],"reasons":[]}';
  fake = {
    testerBodies: ['#!/bin/zsh\n[[ -n "$HACKMAC_APP_DIR" ]]\n'],
    auditJson: () => '{"goals":[{"id":"R1","met":true,"evidence":"scripts/show.sh가 date로 날짜를 읽어 알림을 띄운다","gap":""}],"baseline":[' + ['S2', 'S3', 'S4', 'S5', 'S6', 'S8'].map((id) => `{"id":"${id}","met":true,"evidence":"scripts/show.sh 확인","gap":""}`).join(',') + ']}',
    testerTouchesScript: false,
    delayMs: 0,
  };
  roleCalls = [];
  learned = [];
  ended = new Promise((r) => (endResolve = r));
  let testerRound = 0;
  let auditRound = 0;
  builder = new Builder({
    workDir: work,
    progressFile: join(tmp, 'progress.jsonl'),
    gate: { capabilities: { popup: 1 }, realHome: homedir(), popupStub: STUB },
    evaluator: () => ({ ask: async () => `여기 결과입니다\n${verdictJson}`, by: 'codex' }),
    evaluateContext: { capabilities: '능력 목록', macosVersion: '26.0' },
    installedVersion: () => null,
    install: (dir) => { installs.push(dir); return { ok: true, id: 'my.today', version: 1 }; },
    onState: (s) => states.push(s),
    roleBy: (r) => (r === 'tester' || r === 'auditor' || r === 'examiner' ? 'codex' : 'claude'),
    lessons: () => ['예전에 배운 것'],
    learn: (_k, t) => learned.push(t),
    onPipelineEnd: (o, text) => endResolve({ o, text }),
    runRole: async (role, prompt) => {
      roleCalls.push({ role, prompt });
      if (fake.delayMs) await new Promise((r) => setTimeout(r, fake.delayMs));
      switch (role) {
        case 'examiner':
          return '{"items":[{"id":"R1.1","req":"R1","criterion":"단축키를 누르면 오늘 날짜(YYYY-MM-DD)가 알림으로 뜬다","how":"manual"},{"id":"R1.2","req":"R1","criterion":"날짜 문자열이 date +%F와 같다","how":"auto"}]}';
        case 'designer':
          mkdirSync(join(work, 'spec'), { recursive: true });
          writeFileSync(join(work, 'spec', 'design.md'), '# 설계\n## R1\nshow.sh가 date +%F를 읽어 display notification으로 띄운다. 설정은 없다.\n');
          return '설계를 마쳤다';
        case 'developer':
          writeApp(undefined, false);
          return '만들었다';
        case 'copywriter':
          return '카피를 마쳤다';
        case 'tester': {
          const body = fake.testerBodies[Math.min(testerRound++, fake.testerBodies.length - 1)];
          mkdirSync(join(work, 'app', 'checks'), { recursive: true });
          writeFileSync(join(work, 'app', 'checks', 'R1-date.sh'), body);
          if (fake.testerTouchesScript) writeFileSync(join(work, 'app', 'scripts', 'show.sh'), '#!/bin/zsh\necho "시험 담당이 바꿈"\n');
          return '시험을 만들었다';
        }
        case 'auditor':
          return fake.auditJson(auditRound++);
      }
    },
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
    expect(s.requirements).toEqual([{ id: 'R1', text: 'a2', accept: [], manual: '사람', status: 'manual' }, { id: 'R2', text: 'b', accept: [], manual: null, status: 'failed' }]);
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
  it('요구사항(합격 기준) → 평가 → handoff → 채점표·설계·개발·카피·시험 → 검증 실패 → 보완 → 감사 → 설치', async () => {
    expect(await cli('req', 'R1', '단축키를', '누르면', '오늘', '날짜를', '알림으로', '--accept', '날짜가 YYYY-MM-DD로 보인다')).toEqual({ code: 0, out: '기록함' });
    expect(builder.state().requirements[0]).toMatchObject({ text: '단축키를 누르면 오늘 날짜를 알림으로', accept: ['날짜가 YYYY-MM-DD로 보인다'] });

    expect(await cli('handoff')).toMatchObject({ code: 1, out: expect.stringContaining('가능성 평가를 먼저') });
    expect(await cli('evaluate')).toMatchObject({ code: 0, out: expect.stringContaining('가능성 평가: 가능 (평가: codex)') });
    // build 모드에서 submit은 감사를 건너뛰는 길이라 막는다
    expect(await cli('submit')).toMatchObject({ code: 1, out: expect.stringContaining('handoff') });

    // 처음 시험은 실패, 보완 뒤 시험은 통과
    fake.testerBodies = ['#!/bin/zsh\nexit 1\n', '#!/bin/zsh\n[[ -n "$HACKMAC_APP_DIR" ]]\n'];
    fake.delayMs = 150; // 두 번째 handoff가 도는 중에 닿게
    const h = await cli('handoff');
    expect(h).toMatchObject({ code: 0, out: expect.stringContaining('넘겼다') });
    expect(await cli('handoff')).toMatchObject({ code: 1, out: expect.stringContaining('이미') });
    const { o, text } = await ended;
    expect(o).toMatchObject({ ok: true, appId: 'my.today', rounds: 1 });
    expect(installs).toEqual([join(work, 'app')]);

    // 순서: 채점 → 설계 → 개발 → 카피 → 시험 → (검증 실패) → 개발 보완 → 시험 보완 → 감사
    expect(roleCalls.map((c) => c.role)).toEqual(['examiner', 'designer', 'developer', 'copywriter', 'tester', 'developer', 'tester', 'auditor']);
    // 채점표가 설계·개발·시험·감사 모두에게 간다. 사용자 합격 기준과 배운 것도
    for (const c of roleCalls.filter((x) => x.role !== 'examiner' && x.role !== 'copywriter')) expect(c.prompt, c.role).toContain('R1.2');
    expect(roleCalls[0].prompt).toContain('사용자 합격 기준: 날짜가 YYYY-MM-DD로 보인다');
    expect(roleCalls[1].prompt).toContain('예전에 배운 것');
    expect(roleCalls[5].prompt).toContain('1번째 보완');

    const s = builder.state();
    expect(s).toMatchObject({ step: 6, installed: { appId: 'my.today' }, pipeline: { status: 'done' }, rubric: { by: 'codex' }, audit: { ok: true, by: 'codex' } });
    expect(s.rubric!.items.map((x) => x.id)).toEqual(['R1.1', 'R1.2']);
    // 결과 글은 확인한 것과 못 한 것을 나눈다
    expect(text).toContain('설치함: "오늘 날짜"(id my.today');
    expect(text).toContain('켤 때 HackMac이 비어 있는 자리');
    expect(text).toContain('R1 단축키를 누르면 오늘 날짜를 알림으로: scripts/show.sh가 date로');
    expect(text).toContain('자동으로 확인하지 못한 것(사람이 봐야 함)');
    expect(text).toContain('R1.1 단축키를 누르면 오늘 날짜(YYYY-MM-DD)가 알림으로 뜬다');
    // 보완으로 고친 것은 배운 것으로 남는다
    expect(learned.join('\n')).toContain('제작 중 걸렸다가 고친 것');
    // 진행 기록은 작업 폴더 밖에 있다
    expect(existsSync(join(tmp, 'progress.jsonl'))).toBe(true);
    expect(existsSync(join(work, '.hackmac', 'progress.jsonl'))).toBe(false);
  }, 60_000);

  it('감사가 미충족이면 설치하지 않고 보완을 돌리다가, 끝내 안 되면 실패로 돌려준다', async () => {
    fake.auditJson = () => '{"goals":[{"id":"R1","met":false,"evidence":"","gap":"알림 시각을 바꿀 설정이 없다"}],"baseline":[]}';
    await cli('req', 'R1', '오늘 날짜를 알림으로');
    await cli('evaluate');
    await cli('handoff');
    const { o, text } = await ended;
    expect(o).toMatchObject({ ok: false, stage: '감사', cancelled: false });
    expect(installs).toEqual([]);
    const audits = roleCalls.filter((c) => c.role === 'auditor');
    expect(audits).toHaveLength(4); // 처음 + 보완 3번
    // 보완 뒤 감사는 지난 지적을 받아 그것부터 본다(기준을 계속 올리지 않게)
    expect(audits[0].prompt).not.toContain('지난 감사가 지적한 것');
    expect(audits[1].prompt).toContain('지난 감사가 지적한 것');
    expect(audits[1].prompt).toContain('알림 시각을 바꿀 설정이 없다');
    const fixPrompt = roleCalls.find((c) => c.role === 'developer' && c.prompt.includes('보완'))!.prompt;
    expect(fixPrompt).toContain('[감사 R1]');
    expect(fixPrompt).toContain('알림 시각을 바꿀 설정이 없다');
    expect(fixPrompt).toContain('[감사 S2]'); // 판정하지 않은 기준은 미충족으로 친다
    expect(text).toContain('실패(감사)');
    expect(builder.state().audit!.ok).toBe(false);
    expect(builder.state().pipeline!.status).toBe('failed');
  }, 60_000);

  it('시험 담당이 앱 코드를 바꾸면 되돌린다', async () => {
    fake.testerTouchesScript = true;
    await cli('req', 'R1', '오늘 날짜를 알림으로');
    await cli('evaluate');
    await cli('handoff');
    const { o } = await ended;
    expect(o.ok).toBe(true);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(work, 'app', 'scripts', 'show.sh'), 'utf8')).toContain('date +%F');
    expect(builder.state().log.map((l) => l.text).join('\n')).toContain('시험 담당이 앱 코드를 바꿔서 되돌렸어요');
  }, 60_000);

  it('불가능 평가면 handoff를 막는다', async () => {
    verdictJson = '{"kind":"impossible","summary":"macOS가 막아요","conditions":[],"reasons":["SIP"]}';
    await cli('req', 'R1', '시스템 파일 고치기');
    await cli('evaluate');
    expect(await cli('handoff')).toMatchObject({ code: 1, out: expect.stringContaining('불가능') });
    expect(installs).toEqual([]);
  }, 30_000);

  it('cancel로 멈춘다', async () => {
    await cli('req', 'R1', '오늘 날짜를 알림으로');
    await cli('evaluate');
    expect(await cli('cancel')).toMatchObject({ code: 1, out: expect.stringContaining('없다') });
    fake.delayMs = 500;
    await cli('handoff');
    await cli('cancel');
    const { o } = await ended;
    expect(o).toMatchObject({ ok: false, cancelled: true });
    expect(installs).toEqual([]);
  }, 30_000);

  it('learn은 사용자 취향을 남긴다', async () => {
    expect(await cli('learn', '회의', '중에는', '창보다', '배너가', '좋다')).toMatchObject({ code: 0 });
    expect(learned).toEqual(['회의 중에는 창보다 배너가 좋다']);
  });

  it('틀린 사건은 이유와 함께 거절하고, 모르는 명령은 사용법을 보인다', async () => {
    expect(await cli('req', 'one', '뭔가')).toEqual({ code: 1, out: '요구사항 번호는 R1, R2 … 형식' });
    expect(await cli('step', '6')).toMatchObject({ code: 1 });
    expect(await cli('fail', '--type', 'macos', '--needed', '화면 녹화 권한', '--evidence', '시도1', '--evidence', '문서')).toMatchObject({ code: 0 });
    expect(builder.state().failures[0]).toMatchObject({ failure: 'macos', counted: true });
    expect(await cli('nope')).toMatchObject({ code: 2, out: expect.stringContaining('사용법') });
    expect(await cli('status')).toMatchObject({ code: 0, out: expect.stringContaining('단계 1 요구 정리') });
  }, 30_000);

});
