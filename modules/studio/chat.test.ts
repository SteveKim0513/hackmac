import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Vendor } from '../account/cli.ts';
import { createConversation } from '../conversation/index.ts';
import { ThreadStore } from '../thread/thread.ts';
import { Chats, titleFrom, type ChatEvent } from './chat.ts';

const FIXTURES = join(process.cwd(), 'modules', 'conversation', 'fixtures');
let tmp: string;
let threads: ThreadStore;
let events: { id: string; e: ChatEvent }[];
let loggedIn: Set<Vendor>;
let chats: Chats;

const until = async (pred: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 10)); }
};

const make = (defaultVendor: Vendor | null = 'claude') =>
  new Chats({
    threads,
    defaultVendor: () => defaultVendor,
    engineFor: (v) => (loggedIn.has(v) ? { bin: process.execPath, env: { ...process.env } as Record<string, string> } : null),
    instructions: '요구만 정리한다',
    onEvent: (id, e) => events.push({ id, e }),
    create: (v, o) => createConversation(v, { ...o, prefixArgs: [join(FIXTURES, `fake-${v}.mjs`)] }),
  });

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-chat-'));
  threads = new ThreadStore(join(tmp, 'threads'));
  events = [];
  loggedIn = new Set(['claude', 'codex']);
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
    loggedIn.delete('claude');
    chats = make('codex');
    expect(await chats.send(t.id, '이어서')).toEqual({ ok: false, reason: expect.stringContaining('Claude에 다시 로그인') });
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
});
