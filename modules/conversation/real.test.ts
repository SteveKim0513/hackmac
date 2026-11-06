/**
 * 실제 CLI로 도는 시험. 구독 사용량을 조금 쓰므로 평소엔 건너뛴다:
 *   HACKMAC_REAL_ENGINES=1 npx vitest run modules/conversation/real.test.ts
 * 로그인돼 있지 않은 CLI는 건너뛴다.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanEnv, cliStatus, type Vendor } from '../account/cli.ts';
import { createConversation, type Conversation, type ConversationEvent } from './index.ts';

const REAL = process.env.HACKMAC_REAL_ENGINES === '1';
const cwd = mkdtempSync(join(tmpdir(), 'hackmac-real-'));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const until = async (pred: () => boolean, ms: number): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 50)); }
};

const turn = async (c: Conversation, text: string, ms = 120_000): Promise<Extract<ConversationEvent, { kind: 'turnEnd' }>> => {
  let end: Extract<ConversationEvent, { kind: 'turnEnd' }> | null = null;
  const off = c.onEvent((e) => { if (e.kind === 'turnEnd') end = e; });
  c.send(text);
  await until(() => end !== null, ms);
  off();
  return end!;
};

for (const vendor of ['claude', 'codex'] as Vendor[]) {
  describe.skipIf(!REAL)(`실제 ${vendor}`, () => {
    let bin: string | null = null;
    let session: string | null = null;

    it('로그인 상태를 읽는다', async () => {
      const r = await cliStatus(vendor);
      expect(r.installed).toBe(true);
      expect(r.status?.loggedIn).toBe(true);
      bin = r.bin;
    }, 30_000);

    it('짧은 답을 받는다', async () => {
      const c = createConversation(vendor, { bin: bin!, cwd, env: cleanEnv() });
      const texts: string[] = [];
      c.onEvent((e) => { if (e.kind === 'text' && e.phase === 'answer') texts.push(e.delta); });
      await c.start();
      const end = await turn(c, 'Reply with exactly the single word: pong');
      expect(end).toMatchObject({ ok: true, error: null });
      expect(end.text.toLowerCase()).toContain('pong');
      expect(texts.join('').toLowerCase()).toContain('pong');
      session = c.session;
      expect(session).toBeTruthy();
      await c.stop();
    }, 150_000);

    it('세션을 이어 열면 앞의 대화를 기억한다', async () => {
      const c = createConversation(vendor, { bin: bin!, cwd, env: cleanEnv(), resume: session! });
      await c.start();
      const end = await turn(c, 'What single word did you reply with in your previous message? Reply with only that word.');
      expect(end.ok).toBe(true);
      expect(end.text.toLowerCase()).toContain('pong');
      expect(c.session).toBe(session);
      await c.stop();
    }, 150_000);

    it('긴 일을 중단하면 interrupted로 끝나고 프로세스는 산다', async () => {
      const c = createConversation(vendor, { bin: bin!, cwd, env: cleanEnv() });
      let sawText = false;
      let end: Extract<ConversationEvent, { kind: 'turnEnd' }> | null = null;
      c.onEvent((e) => {
        if (e.kind === 'text') sawText = true;
        if (e.kind === 'turnEnd') end = e;
      });
      await c.start();
      c.send('Write the numbers from 1 to 400, one per line, with no other text.');
      await until(() => sawText, 120_000);
      await c.interrupt();
      expect(end).toMatchObject({ interrupted: true });
      expect(c.alive).toBe(true);
      await c.stop();
    }, 150_000);
  });
}
