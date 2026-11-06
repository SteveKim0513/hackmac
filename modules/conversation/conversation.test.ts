import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Vendor } from '../account/cli.ts';
import { createConversation, type Conversation, type ConversationEvent } from './index.ts';

const FIXTURES = join(process.cwd(), 'modules', 'conversation', 'fixtures');
let cwd: string;
const live: Conversation[] = [];

beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'hackmac-conv-')); });
afterEach(async () => {
  await Promise.all(live.splice(0).map((c) => c.stop()));
  rmSync(cwd, { recursive: true, force: true });
});

const open = (vendor: Vendor, resume?: string) => {
  const c = createConversation(vendor, { bin: process.execPath, prefixArgs: [join(FIXTURES, `fake-${vendor}.mjs`)], cwd, env: { ...process.env } as Record<string, string>, resume });
  live.push(c);
  const events: ConversationEvent[] = [];
  c.onEvent((e) => events.push(e));
  return { c, events };
};

const until = async (pred: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 10)); }
};
const ends = (es: ConversationEvent[]) => es.filter((e): e is Extract<ConversationEvent, { kind: 'turnEnd' }> => e.kind === 'turnEnd');
const answer = (es: ConversationEvent[]) => es.filter((e): e is Extract<ConversationEvent, { kind: 'text' }> => e.kind === 'text' && e.phase === 'answer').map((e) => e.delta).join('');

for (const vendor of ['claude', 'codex'] as const) {
  describe(`${vendor} 어댑터(가짜 CLI)`, () => {
    it('글을 보내면 조각이 오고 턴이 끝난다', async () => {
      const { c, events } = open(vendor);
      await c.start();
      c.send('안녕');
      expect(c.busy).toBe(true);
      await until(() => ends(events).length === 1);
      expect(c.busy).toBe(false);
      expect(answer(events)).toBe('echo:안녕');
      expect(ends(events)[0]).toEqual({ kind: 'turnEnd', ok: true, text: 'echo:안녕', error: null, interrupted: false });
      expect(c.session).toBe(vendor === 'claude' ? 'sess-new' : 'thread-new');
    });

    it('일하는 중 보낸 글은 줄 서서 차례로 돈다', async () => {
      const { c, events } = open(vendor);
      await c.start();
      c.send('하나');
      c.send('둘');
      await until(() => ends(events).length === 2);
      expect(ends(events).map((e) => e.text)).toEqual(['echo:하나', 'echo:둘']);
    });

    it('중단하면 interrupted로 끝나고 다음 글을 받는다', async () => {
      const { c, events } = open(vendor);
      await c.start();
      c.send('slow');
      c.send('버려질 글');
      await new Promise((r) => setTimeout(r, 100));
      await c.interrupt();
      expect(ends(events)).toEqual([{ kind: 'turnEnd', ok: false, text: '', error: null, interrupted: true }]);
      expect(c.alive).toBe(true);
      c.send('다음');
      await until(() => ends(events).length === 2);
      expect(ends(events)[1].text).toBe('echo:다음');
    });

    it('엔진이 죽으면 실패한 턴과 예상 못 한 exit, 표준 오류가 남는다', async () => {
      const { c, events } = open(vendor);
      await c.start();
      c.send('die');
      c.send('줄 선 글');
      await until(() => events.some((e) => e.kind === 'exit'));
      expect(ends(events)).toHaveLength(1);
      expect(ends(events)[0]).toMatchObject({ ok: false, error: expect.stringContaining('죽음') });
      expect(events.at(-1)).toEqual({ kind: 'exit', code: 3, signal: null, expected: false });
      expect(c.busy).toBe(false);
    });

    it('resume이면 같은 세션으로 이어 연다', async () => {
      const { c, events } = open(vendor, 'old-session');
      await c.start();
      c.send('이어서');
      await until(() => ends(events).length === 1);
      expect(c.session).toBe('old-session');
    });

    it('stop은 예상된 exit', async () => {
      const { c, events } = open(vendor);
      await c.start();
      await c.stop();
      expect(events.at(-1)).toMatchObject({ kind: 'exit', expected: true });
      expect(c.alive).toBe(false);
    });
  });
}

describe('claude 어댑터 세부', () => {
  it('팀원 안쪽 글은 버리고, 도구와 한도를 읽는다', async () => {
    const { c, events } = open('claude');
    await c.start();
    c.send('tool');
    await until(() => ends(events).length === 1);
    expect(answer(events)).toBe('echo:tool');
    expect(events).toContainEqual({ kind: 'tool', name: 'Bash' });
    expect(events.filter((e) => e.kind === 'limit')).toEqual([
      { kind: 'limit', window: 'five_hour', used: 0.4, resetsAt: 1800000000000, blocked: false },
      { kind: 'limit', window: 'seven_day', used: 0.72, resetsAt: 1800500000000, blocked: false },
    ]);
  });
});

describe('codex 어댑터 세부', () => {
  it('중간 설명은 commentary, 명령 실행은 도구, 주간 한도 100%는 막힘', async () => {
    const { c, events } = open('codex');
    await c.start();
    c.send('x');
    await until(() => ends(events).length === 1);
    expect(events).toContainEqual({ kind: 'text', delta: '살펴보는 중', phase: 'commentary' });
    expect(events).toContainEqual({ kind: 'tool', name: 'commandExecution' });
    expect(ends(events)[0].text).toBe('echo:x');
    expect(events.filter((e) => e.kind === 'limit')).toEqual([
      { kind: 'limit', window: 'five_hour', used: 0.03, resetsAt: 1793946175000, blocked: false },
      { kind: 'limit', window: 'seven_day', used: 1, resetsAt: 1794460954000, blocked: true },
    ]);
  });

  it('승인 요청에는 거절로 자동 응답해 턴이 멈추지 않는다', async () => {
    const { c, events } = open('codex');
    await c.start();
    c.send('approve');
    await until(() => ends(events).length === 1);
    expect(ends(events)[0].text).toBe('decision:decline');
  });
});
