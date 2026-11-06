import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Vendor } from '../account/cli.ts';
import { createConversation, type ConversationOptions } from '../conversation/index.ts';
import { buildRecipe, parseRecipe, recipeInstructions, recipeTitle } from '../recipe/recipe.ts';
import { normalizeMemory } from '../memory/memory.ts';
import { ThreadStore } from '../thread/thread.ts';
import { Chats, titleFrom, type ChatEvent } from './chat.ts';

const FIXTURES = join(process.cwd(), 'modules', 'conversation', 'fixtures');
let tmp: string;
let threads: ThreadStore;
let events: { id: string; e: ChatEvent }[];
let loggedIn: Set<string>;
let active: Record<Vendor, string>;
let copies: { vendor: Vendor; from: string; to: string; session: string }[];
let copyOk: boolean;
let envSeen: Record<string, string>[];
let chats: Chats;

const until = async (pred: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 10)); }
};

const make = (defaultVendor: Vendor | null = 'claude') =>
  new Chats({
    threads,
    defaultVendor: () => defaultVendor,
    activeAccount: (v) => active[v],
    accountLabel: (id) => (id.endsWith('-default') ? '기본 계정' : `계정 ${id.split('-')[1]}`),
    engineFor: (v, account) => (loggedIn.has(account) && account.startsWith(`${v}-`) ? { bin: process.execPath, env: { ...process.env, HM_ACCOUNT: account } as Record<string, string> } : null),
    copySession: (vendor, from, to, session) => {
      copies.push({ vendor, from, to, session });
      return copyOk ? { ok: true } : { ok: false, detail: '원본 없음' };
    },
    instructions: '요구만 정리한다',
    onEvent: (id, e) => events.push({ id, e }),
    create: (v, o) => { envSeen.push(o.env); return createConversation(v, { ...o, prefixArgs: [join(FIXTURES, `fake-${v}.mjs`)] }); },
  });

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-chat-'));
  threads = new ThreadStore(join(tmp, 'threads'));
  events = [];
  loggedIn = new Set(['claude-default', 'codex-default']);
  active = { claude: 'claude-default', codex: 'codex-default' };
  copies = [];
  copyOk = true;
  envSeen = [];
  chats = make();
});
afterEach(async () => {
  await chats.stopAll();
  rmSync(tmp, { recursive: true, force: true });
});

describe('ThreadStore', () => {
  it('만들고, 글을 쌓고, 최근 것부터 보이고, 보관함으로 옮긴다', async () => {
    let t = Date.parse('2026-11-06T10:00:00Z');
    threads = new ThreadStore(join(tmp, 'threads'), () => new Date((t += 1000)));
    const a = threads.create('  ');
    expect(a).toMatchObject({ title: '새 앱', vendor: null, session: null, appId: null });
    const b = threads.create('주가 표시');
    threads.append(a.id, { role: 'user', text: '안녕' });
    expect(threads.list().map((t) => t.id)).toEqual([a.id, b.id]);
    appendFileSync(join(tmp, 'threads', a.id, 'messages.jsonl'), '{깨진 줄\n');
    expect(threads.messages(a.id).map((m) => m.text)).toEqual(['안녕']);
    threads.archive(b.id);
    expect(threads.list().map((t) => t.id)).toEqual([a.id]);
    expect(existsSync(join(tmp, 'threads', '.archive', b.id, 'thread.json'))).toBe(true);
    expect(threads.get('../x')).toBeNull();
    expect(() => threads.append('../x', { role: 'user', text: 'x' })).toThrow();
  });
});

describe('titleFrom', () => {
  it('첫 줄 앞 24자, 넘치면 말줄임', () => {
    expect(titleFrom('  주가를 메뉴바에\n자세히는')).toBe('주가를 메뉴바에');
    expect(titleFrom('가'.repeat(30))).toBe(`${'가'.repeat(24)}…`);
  });
});

describe('Chats', () => {
  it('첫 글에 엔진을 열고, 세션과 회사를 스레드에 남기고, 답을 저장한다', async () => {
    const t = threads.create('');
    expect(await chats.send(t.id, '안녕')).toEqual({ ok: true });
    expect(threads.get(t.id)!.title).toBe('안녕');
    await until(() => threads.messages(t.id).length === 2);
    expect(threads.messages(t.id).map((m) => [m.role, m.text])).toEqual([['user', '안녕'], ['assistant', 'echo:안녕']]);
    expect(threads.get(t.id)).toMatchObject({ vendor: 'claude', session: 'sess-new' });
    const kinds = events.map((x) => x.e.kind);
    expect(kinds[0]).toBe('message');
    expect(kinds).toContain('text');
    expect(events.at(-1)!.e).toEqual({ kind: 'state', busy: false });
  });

  it('엔진이 죽은 뒤 다음 글은 같은 세션으로 이어 연다', async () => {
    const t = threads.create('x');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    await chats.send(t.id, 'die');
    await until(() => threads.messages(t.id).length === 4);
    expect(threads.messages(t.id)[3]).toMatchObject({ role: 'assistant', error: expect.stringContaining('죽음') });
    await until(() => events.some((x) => x.e.kind === 'exit'));
    await chats.send(t.id, '다시');
    await until(() => threads.messages(t.id).length === 6);
    expect(threads.messages(t.id)[5].text).toBe('echo:다시');
    expect(threads.get(t.id)!.session).toBe('sess-new');
  });

  it('스레드는 처음 회사를 지킨다. 그 회사가 로그아웃되면 보내지 않는다', async () => {
    const t = threads.create('x');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    await chats.stopAll();
    loggedIn.delete('claude-default');
    chats = make('codex');
    expect(await chats.send(t.id, '이어서')).toEqual({ ok: false, reason: expect.stringContaining('기본 계정') });
    expect(threads.messages(t.id)).toHaveLength(2);
  });

  it('새 스레드는 기본 엔진을 쓴다(Codex)', async () => {
    chats = make('codex');
    const t = threads.create('x');
    await chats.send(t.id, '안녕');
    await until(() => threads.messages(t.id).length === 2);
    expect(threads.get(t.id)).toMatchObject({ vendor: 'codex', session: 'thread-new' });
    expect(threads.messages(t.id)[1].text).toBe('echo:안녕');
  });

  it('엔진이 하나도 없으면 이유를 돌려준다', async () => {
    chats = make(null);
    const t = threads.create('x');
    expect(await chats.send(t.id, '안녕')).toEqual({ ok: false, reason: '로그인한 엔진이 없어요' });
  });

  it('중단하면 interrupted 답이 남는다', async () => {
    const t = threads.create('x');
    await chats.send(t.id, 'slow');
    await new Promise((r) => setTimeout(r, 100));
    await chats.interrupt(t.id);
    await until(() => threads.messages(t.id).length === 2);
    expect(threads.messages(t.id)[1]).toMatchObject({ role: 'assistant', interrupted: true });
  });

  it('새 스레드는 지금 쓰는 계정으로 시작하고, 그 계정을 스레드가 기억한다(나중에 기본이 바뀌어도)', async () => {
    loggedIn.add('claude-2');
    active.claude = 'claude-2';
    const t = threads.create('x');
    await chats.send(t.id, '안녕');
    await until(() => threads.messages(t.id).length === 2);
    expect(threads.get(t.id)).toMatchObject({ vendor: 'claude', account: 'claude-2' });
    expect(envSeen.at(-1)).toMatchObject({ HM_ACCOUNT: 'claude-2' });
    await chats.stopAll();
    active.claude = 'claude-default';
    await chats.send(t.id, '다음');
    await until(() => threads.messages(t.id).length === 4);
    expect(envSeen.at(-1)).toMatchObject({ HM_ACCOUNT: 'claude-2' });
  });

  it('수동 전환: 세션 기록을 복사해 같은 세션으로 이어 열고, 알림 글이 남는다', async () => {
    loggedIn.add('claude-2');
    const t = threads.create('x');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    expect(await chats.moveAccount(t.id, 'claude-2')).toEqual({ ok: true });
    expect(copies).toEqual([{ vendor: 'claude', from: 'claude-default', to: 'claude-2', session: 'sess-new' }]);
    expect(threads.get(t.id)).toMatchObject({ account: 'claude-2', session: 'sess-new' });
    expect(threads.messages(t.id).at(-1)).toMatchObject({ role: 'notice', text: expect.stringContaining('진행 중이던 대화도 그대로 이어져요') });
    await chats.send(t.id, '이어서');
    await until(() => threads.messages(t.id).length === 5);
    expect(envSeen.at(-1)).toMatchObject({ HM_ACCOUNT: 'claude-2' });
    expect(threads.messages(t.id).at(-1)!.text).toBe('echo:이어서');
  });

  it('수동 전환: 복사하지 못하면 세션을 비우고 새 대화로 시작한다고 알린다', async () => {
    loggedIn.add('claude-2');
    copyOk = false;
    const t = threads.create('x');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    expect(await chats.moveAccount(t.id, 'claude-2')).toEqual({ ok: true });
    expect(threads.get(t.id)).toMatchObject({ account: 'claude-2', session: null });
    expect(threads.messages(t.id).at(-1)).toMatchObject({ role: 'notice', text: expect.stringContaining('새 대화로 시작해요') });
  });

  it('수동 전환을 막는 경우: 다른 회사·로그인 안 된 계정·일하는 중·시작 전·같은 계정', async () => {
    loggedIn.add('claude-2');
    const fresh = threads.create('x');
    expect(await chats.moveAccount(fresh.id, 'claude-2')).toMatchObject({ ok: false, reason: expect.stringContaining('아직 시작하지 않은') });
    const t = threads.create('y');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    expect(await chats.moveAccount(t.id, 'codex-default')).toMatchObject({ ok: false, reason: expect.stringContaining('같은 회사') });
    expect(await chats.moveAccount(t.id, 'claude-3')).toMatchObject({ ok: false, reason: expect.stringContaining('로그인돼 있지 않아요') });
    expect(await chats.moveAccount(t.id, 'claude-default')).toEqual({ ok: true });
    expect(copies).toEqual([]);
    await chats.send(t.id, 'slow');
    await new Promise((r) => setTimeout(r, 80));
    expect(await chats.moveAccount(t.id, 'claude-2')).toMatchObject({ ok: false, reason: expect.stringContaining('답을 쓰는 중') });
    expect(threads.get(t.id)!.account).toBe('claude-default');
  });

  it('옮긴 계정에서 이어 열기가 실패하면 새 대화로 시작하고 알린다(Codex: 세션 기록만 복사해서는 안 열릴 수 있다)', async () => {
    chats = new Chats({
      threads, defaultVendor: () => 'claude', activeAccount: (v) => active[v], accountLabel: (id) => id,
      engineFor: () => ({ bin: process.execPath, env: { ...process.env } as Record<string, string> }),
      copySession: () => ({ ok: true }), instructions: 'x', onEvent: (id, e) => events.push({ id, e }),
      create: (v, o) => createConversation(v, { ...o, prefixArgs: [join(FIXTURES, `fake-${v}.mjs`)], env: { ...o.env, ...(o.resume ? { HACKMAC_FAKE_RESUME_FAIL: '1' } : {}) } }),
    });
    const t = threads.create('x');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    await chats.close(t.id);
    expect(await chats.send(t.id, '이어서')).toEqual({ ok: true });
    await until(() => threads.messages(t.id).some((m) => m.text === 'echo:이어서'));
    expect(threads.messages(t.id).some((m) => m.role === 'notice' && m.text.includes('새 대화로 시작해요'))).toBe(true);
  });
});

describe('Chats: 기억(12.2)과 레시피(12.3)', () => {
  let opened: ConversationOptions[];
  let memoryText: string | null;
  const makeWith = () =>
    new Chats({
      threads, defaultVendor: () => 'claude', activeAccount: (v) => active[v], accountLabel: (id) => id,
      engineFor: () => ({ bin: process.execPath, env: { ...process.env } as Record<string, string> }),
      copySession: () => ({ ok: true }), instructions: '기본 지시', onEvent: (id, e) => events.push({ id, e }),
      memoryContext: () => memoryText,
      recipe: { detect: (t) => parseRecipe(t) !== null, instructions: recipeInstructions, title: recipeTitle },
      create: (v, o) => { opened.push(o); return createConversation(v, { ...o, prefixArgs: [join(FIXTURES, `fake-${v}.mjs`)] }); },
    });
  const recipeText = buildRecipe(normalizeMemory({ goal: '메뉴바에 시계를 보여 준다', requirements: [{ id: 'R1', text: '시계를 보여 준다' }], environment: [{ fact: '내 시간대는 서울', blank: '시간대' }] }, { messages: 1, lastAt: null }, new Date())!).text;

  beforeEach(() => { opened = []; memoryText = null; });

  it('레시피를 붙여넣은 첫 글이면 짧은 모드: 지시가 붙고, 제목은 목표 한 줄, 다시 열어도 유지된다', async () => {
    chats = makeWith();
    const t = threads.create('');
    await chats.send(t.id, recipeText);
    await until(() => threads.messages(t.id).length === 2);
    expect(opened[0].instructions).toContain('기본 지시');
    expect(opened[0].instructions).toContain('레시피로 만드는 중');
    expect(threads.get(t.id)).toMatchObject({ recipe: true, title: '메뉴바에 시계를 보여 준다' });
    await chats.close(t.id);
    await chats.send(t.id, '시간대는 서울이에요');
    await until(() => threads.messages(t.id).length === 4);
    expect(opened[1].instructions).toContain('레시피로 만드는 중');
  });

  it('일반 글로 시작하면 레시피 모드가 아니다. 중간에 레시피를 붙여넣어도 모드가 바뀌지 않는다', async () => {
    chats = makeWith();
    const t = threads.create('');
    await chats.send(t.id, '메뉴바에 시계를 넣고 싶어요');
    await until(() => threads.messages(t.id).length === 2);
    expect(opened[0].instructions).toBe('기본 지시');
    await chats.send(t.id, recipeText);
    await until(() => threads.messages(t.id).length === 4);
    expect(threads.get(t.id)!.recipe).toBeUndefined();
  });

  it('기억이 최신이면 --resume 대신 새 세션에 기억을 넣고, 알림 글을 남긴다', async () => {
    chats = makeWith();
    const t = threads.create('');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    expect(threads.get(t.id)!.session).toBe('sess-new');
    await chats.close(t.id);

    memoryText = '## 이 앱의 기억\n목표: 시계';
    await chats.send(t.id, '이어서');
    await until(() => threads.messages(t.id).some((m) => m.text === 'echo:이어서'));
    expect(opened[1].resume).toBeUndefined();
    expect(opened[1].instructions).toContain('## 이 앱의 기억\n목표: 시계');
    expect(threads.messages(t.id).some((m) => m.role === 'notice' && m.text.includes('기억을 불러와서'))).toBe(true);
  });

  it('기억이 없거나 낡았으면(null) 평소처럼 세션을 이어 연다', async () => {
    chats = makeWith();
    const t = threads.create('');
    await chats.send(t.id, '처음');
    await until(() => threads.messages(t.id).length === 2);
    await chats.close(t.id);
    await chats.send(t.id, '이어서');
    await until(() => threads.messages(t.id).some((m) => m.text === 'echo:이어서'));
    expect(opened[1].resume).toBe('sess-new');
    expect(threads.messages(t.id).some((m) => m.role === 'notice')).toBe(false);
  });
});
