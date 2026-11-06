/** 한 번 묻고 답을 받은 뒤 엔진을 닫는다(가능성 평가처럼 대화를 이어갈 필요가 없는 일) */
import type { Vendor } from '../account/cli.ts';
import { createConversation } from './index.ts';
import type { Conversation, ConversationEvent, ConversationOptions } from './types.ts';

export async function askOnce(
  vendor: Vendor,
  o: ConversationOptions,
  prompt: string,
  timeoutMs = 300_000,
  create: (v: Vendor, o: ConversationOptions) => Conversation = createConversation,
  /** 멈추면 엔진을 끄고 실패로 끝낸다(제작 파이프라인의 cancel) */
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error('멈춤');
  const c = create(vendor, o);
  const onAbort = () => void c.stop();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await c.start();
    const end = await new Promise<Extract<ConversationEvent, { kind: 'turnEnd' }>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${Math.round(timeoutMs / 1000)}초 안에 답이 없음`)), timeoutMs);
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('멈춤')); }, { once: true });
      c.onEvent((e) => {
        if (e.kind === 'turnEnd') { clearTimeout(t); resolve(e); }
        if (e.kind === 'exit' && !e.expected) { clearTimeout(t); reject(new Error(c.lastError || '엔진이 끝남')); }
      });
      c.send(prompt);
    });
    if (!end.ok) throw new Error(end.error ?? '실패');
    return end.text;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    await c.stop();
  }
}
