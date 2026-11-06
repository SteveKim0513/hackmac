import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '../thread/thread.ts';
import { Compactor } from './compactor.ts';
import { basedOnOf, compress, extractJson, isCurrent, MemoryStore, memoryPrompt, normalizeMemory, renderForSession, transcriptOf, type AppMemory } from './memory.ts';

const NOW = new Date('2026-11-06T16:00:00Z');
const msg = (role: Message['role'], text: string, at = '2026-11-06T10:00:00.000Z'): Message => ({ at, role, text });
const convo: Message[] = [msg('user', '단축키로 오늘 일정을 알림으로 보고 싶어', '2026-11-06T10:00:00.000Z'), msg('assistant', '어느 캘린더를 쓰나요?', '2026-11-06T10:00:05.000Z'), msg('user', '회사 캘린더 Work', '2026-11-06T10:00:30.000Z'), msg('notice', '쓰는 계정을 바꿨어요', '2026-11-06T10:01:00.000Z'), msg('assistant', '', '2026-11-06T10:01:10.000Z')];

const GOOD = {
  goal: '단축키를 누르면 지정한 캘린더의 오늘 일정을 알림으로 보여 준다',
  requirements: [{ id: 'R1', text: '지정한 캘린더의 오늘 일정을 알림으로 보여 준다' }],
  decisions: [{ what: '알림 배너로 보여 준다', why: '창을 띄우면 방해돼서' }],
  environment: [{ fact: '회사 캘린더 이름은 Work', blank: '캘린더 이름', sensitive: false }, { fact: 'API 키를 쓴다', blank: 'API 키', sensitive: true }],
  tried: [{ method: 'whose 날짜 필터', whyDropped: '20초 넘게 걸려서' }],
  references: [{ repo: 'github.com/x/y', commit: 'a1b2c3', path: 'src/fetch.ts#withRetry', borrowed: '429면 지수 간격으로 3번', why: '자주 429를 줘서', license: 'MIT' }],
  todo: ['실제로 눌러 보기'],
};

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'hackmac-memory-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('normalizeMemory', () => {
  const based = basedOnOf(convo);
  it('칸마다 따져 읽고 모르는 칸·깨진 항목은 버린다. 목표가 없으면 쓸 수 없다', () => {
    const m = normalizeMemory({ ...GOOD, extra: 1, requirements: [{ text: '  ' }, { id: 'R2', text: '둘째' }, 7], decisions: 'x', environment: [{ fact: '값', blank: 3 }], references: [{ repo: '' }] }, based, NOW)!;
    expect(m.requirements).toEqual([{ id: 'R2', text: '둘째', status: 'todo' }]);
    expect(m.decisions).toEqual([]);
    expect(m.environment).toEqual([{ fact: '값', blank: '', sensitive: false }]);
    expect(m.references).toEqual([]);
    expect(m).not.toHaveProperty('extra');
    expect(normalizeMemory({ ...GOOD, goal: '  ' }, based, NOW)).toBeNull();
    expect(normalizeMemory('문자열', based, NOW)).toBeNull();
    expect(normalizeMemory(null, based, NOW)).toBeNull();
  });

  it('대화 상태(알림 글·빈 글은 세지 않는다)를 기록한다', () => {
    expect(basedOnOf(convo)).toEqual({ messages: 3, lastAt: '2026-11-06T10:00:30.000Z' });
  });
});

describe('extractJson', () => {
  it('앞뒤 잡글과 코드 블록을 견딘다', () => {
    expect(extractJson('여기 있어요\n```json\n{"goal":"x"}\n```\n끝')).toEqual({ goal: 'x' });
    expect(extractJson('JSON 없음')).toBeNull();
    expect(extractJson('{깨짐')).toBeNull();
  });
});

describe('compress', () => {
  const input = (over = {}) => ({ messages: convo, previous: null, requirements: [], manifestReferences: [], ...over });

  it('엔진 답을 기억으로 만든다(대화 상태 포함)', async () => {
    const r = await compress(input(), { ask: async () => `결과:\n${JSON.stringify(GOOD)}`, now: () => NOW });
    expect(r).toMatchObject({ ok: true, memory: { goal: GOOD.goal, basedOn: { messages: 3 }, updatedAt: NOW.toISOString() } });
  });

  it('진행 기록의 요구사항이 있으면 엔진 것을 덮어쓴다(상태는 코드가 안다)', async () => {
    const r = await compress(input({ requirements: [{ id: 'R1', text: '진짜 요구사항', status: 'passed' }] }), { ask: async () => JSON.stringify(GOOD) });
    expect(r.ok && r.memory.requirements).toEqual([{ id: 'R1', text: '진짜 요구사항', status: 'passed' }]);
  });

  it('앱 선언의 참고는 정확한 커밋·라이선스로 바꾸되 엔진이 찾은 이유는 살린다. 엔진이 못 찾은 참고도 넣는다', async () => {
    const r = await compress(input({ manifestReferences: [{ repo: 'github.com/x/y', commit: 'FULLSHA', path: 'a.ts', borrowed: '선언의 설명', license: 'Apache-2.0' }, { repo: 'github.com/z/w', commit: 'c0ffee', path: '', borrowed: '다른 것', license: 'MIT' }] }), { ask: async () => JSON.stringify(GOOD) });
    expect(r.ok && r.memory.references).toEqual([
      { repo: 'github.com/x/y', commit: 'FULLSHA', path: 'a.ts', borrowed: '선언의 설명', why: '자주 429를 줘서', license: 'Apache-2.0' },
      { repo: 'github.com/z/w', commit: 'c0ffee', path: '', borrowed: '다른 것', why: '', license: 'MIT' },
    ]);
  });

  it('실패: 대화가 없음·엔진 오류·읽을 수 없는 답', async () => {
    expect(await compress(input({ messages: [msg('notice', '알림')] }), { ask: async () => '' })).toEqual({ ok: false, error: '압축할 대화가 없어요' });
    expect(await compress(input(), { ask: async () => { throw new Error('엔진 죽음'); } })).toMatchObject({ ok: false, error: expect.stringContaining('엔진 죽음') });
    expect(await compress(input(), { ask: async () => '모르겠어요' })).toMatchObject({ ok: false, error: expect.stringContaining('읽지 못했어요') });
  });

  it('프롬프트: 개인 값은 environment로 빼라는 규칙, 이전 기억, 대화, 출력 모양', () => {
    const prev = normalizeMemory(GOOD, basedOnOf(convo), NOW)!;
    const p = memoryPrompt(input({ previous: prev, requirements: [{ id: 'R1', text: '알림', status: 'todo' }] }));
    expect(p).toContain('기억 정리 담당');
    expect(p).toContain('사용자 개인 값');
    expect(p).toContain('이전 기억');
    expect(p).toContain('사용자: 회사 캘린더 Work');
    expect(p).not.toContain('쓰는 계정을 바꿨어요'); // 알림 글은 기억의 재료가 아니다
    expect(p).toContain('"blank"');
  });

  it('긴 대화는 처음과 끝을 남기고 가운데를 줄인다', () => {
    const many = Array.from({ length: 200 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `${i}번째 글 ${'가'.repeat(1000)}`));
    const t = transcriptOf(many);
    expect(t.length).toBeLessThan(40_000);
    expect(t).toContain('0번째 글');
    expect(t).toContain('199번째 글');
    expect(t).toContain('가운데 대화는 길어서 줄였다');
  });
});

describe('isCurrent · renderForSession · MemoryStore', () => {
  const mem = (): AppMemory => normalizeMemory(GOOD, basedOnOf(convo), NOW)!;

  it('새 글이 더 쌓이면 낡은 기억이다(알림 글은 상관없다)', () => {
    expect(isCurrent(mem(), convo)).toBe(true);
    expect(isCurrent(mem(), [...convo, msg('notice', '알림', '2026-11-07T00:00:00.000Z')])).toBe(true);
    expect(isCurrent(mem(), [...convo, msg('user', '하나 더', '2026-11-07T00:00:00.000Z')])).toBe(false);
    expect(isCurrent(null, convo)).toBe(false);
  });

  it('새 세션에 넣는 글: 기억 + 최근 몇 턴만, 환경 사실도 포함(내 앱을 이어 만드는 데는 값이 필요하다)', () => {
    const many = Array.from({ length: 20 }, (_, i) => msg(i % 2 ? 'assistant' : 'user', `글${i}`));
    const text = renderForSession(mem(), many, 4);
    expect(text).toContain('목표: 단축키를 누르면');
    expect(text).toContain('- 회사 캘린더 이름은 Work');
    expect(text).toContain('시도했다 버린 방법(다시 시도하지 않는다):');
    expect(text).toContain('github.com/x/y @ a1b2c3');
    expect(text).toContain('글19');
    expect(text).toContain('글16');
    expect(text).not.toContain('글15');
  });

  it('저장하고 다시 읽으면 같고, 깨진 파일은 null', () => {
    const dir = join(tmp, 't1');
    mkdirSync(dir);
    const s = new MemoryStore(() => dir);
    expect(s.read('t1')).toBeNull();
    s.write('t1', mem());
    expect(s.exists('t1')).toBe(true);
    expect(s.read('t1')).toMatchObject({ goal: GOOD.goal, basedOn: { messages: 3 }, environment: [{ blank: '캘린더 이름' }, { blank: 'API 키', sensitive: true }] });
    writeFileSync(join(dir, 'memory.json'), '{깨짐');
    expect(s.read('t1')).toBeNull();
  });
});

describe('Compactor', () => {
  let now = NOW.getTime();
  let msgs: Record<string, Message[]>;
  let mems: Record<string, AppMemory | null>;
  let busy: Set<string>;
  let ran: string[];
  let outcome: { ok: true } | { ok: false; error: string };
  let failures: string[];
  const make = () => new Compactor({
    now: () => new Date(now), threadIds: () => Object.keys(msgs), messages: (id) => msgs[id], memory: (id) => mems[id] ?? null, busy: (id) => busy.has(id),
    compress: async (id) => { ran.push(id); if (outcome.ok) mems[id] = normalizeMemory(GOOD, basedOnOf(msgs[id]), new Date(now)); return outcome; },
    onFail: (id, e) => failures.push(`${id}:${e}`),
  });
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  beforeEach(() => {
    now = NOW.getTime(); msgs = {}; mems = {}; busy = new Set(); ran = []; outcome = { ok: true }; failures = [];
  });

  it('마지막 글로부터 30분이 지난 스레드만, 오래 쉰 것부터', () => {
    msgs = { fresh: [msg('user', 'x', at(5))], old: [msg('user', 'x', at(40))], older: [msg('user', 'x', at(300))], empty: [msg('notice', 'x', at(999))] };
    expect(make().due()).toEqual(['older', 'old']);
  });

  it('기억이 최신이면 하지 않는다(바뀐 게 없으면 한도를 안 쓴다). 새 글이 쌓이면 다시', async () => {
    msgs = { a: [msg('user', 'x', at(60))] };
    const c = make();
    expect(await c.tick()).toBe('a');
    expect(await c.tick()).toBeNull();
    expect(ran).toEqual(['a']);
    msgs.a = [...msgs.a, msg('user', '새 글', at(45))];
    expect(await c.tick()).toBe('a');
    expect(ran).toEqual(['a', 'a']);
  });

  it('엔진이 일하는 중이면 미룬다', async () => {
    msgs = { a: [msg('user', 'x', at(60))] };
    busy.add('a');
    const c = make();
    expect(await c.tick()).toBeNull();
    busy.clear();
    expect(await c.tick()).toBe('a');
  });

  it('한 번에 하나씩', async () => {
    msgs = { a: [msg('user', 'x', at(60))], b: [msg('user', 'x', at(90))] };
    const c = make();
    expect(await c.tick()).toBe('b');
    expect(ran).toEqual(['b']);
    expect(await c.tick()).toBe('a');
  });

  it('실패하면 같은 상태로는 1시간 뒤에야 다시 한다. 새 글이 오면 바로', async () => {
    msgs = { a: [msg('user', 'x', at(60))] };
    outcome = { ok: false, error: '엔진 죽음' };
    const c = make();
    await c.tick();
    expect(failures).toEqual(['a:엔진 죽음']);
    expect(await c.tick()).toBeNull();
    now += 61 * 60_000;
    expect(await c.tick()).toBe('a');
    msgs.a = [...msgs.a, msg('user', '새 글', new Date(now - 31 * 60_000).toISOString())];
    expect(await c.tick()).toBe('a');
    expect(ran).toHaveLength(3);
  });
});
