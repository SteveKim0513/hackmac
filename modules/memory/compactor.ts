/**
 * 기억 압축을 언제 돌릴지(계획서 12.2). 1분마다 tick이 스레드를 훑는다.
 *   - 마지막 글로부터 30분이 지났을 때만(대화가 끝났다고 본다) [시작값]
 *   - 기억이 없거나 낡았을 때만. 바뀐 게 없으면 하지 않는다(한도 보호)
 *   - 엔진이 일하는 중이면 미룬다
 *   - 실패하면 같은 상태로는 1시간 뒤에야 다시 한다(매 분 실패를 되풀이하며 한도를 쓰지 않게)
 *   - 한 번에 하나씩(여러 스레드가 밀려도 한꺼번에 엔진을 열지 않는다)
 */
import type { Message } from '../thread/thread.ts';
import { basedOnOf, countable, isCurrent, type AppMemory } from './memory.ts';

export interface CompactorDeps {
  now?: () => Date;
  threadIds: () => string[];
  messages: (threadId: string) => Message[];
  memory: (threadId: string) => AppMemory | null;
  /** 그 스레드의 엔진이 일하는 중인가 */
  busy: (threadId: string) => boolean;
  /** 압축해서 저장한다 */
  compress: (threadId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onFail?: (threadId: string, error: string) => void;
  idleMs?: number;
  retryAfterFailMs?: number;
}

export class Compactor {
  private readonly now: () => Date;
  private readonly inFlight = new Set<string>();
  /** 스레드 id → 마지막 실패 시각과 그때의 대화 상태 */
  private readonly failed = new Map<string, { at: number; key: string }>();
  private readonly idleMs: number;
  private readonly retryMs: number;

  constructor(private readonly d: CompactorDeps) {
    this.now = d.now ?? (() => new Date());
    this.idleMs = d.idleMs ?? 30 * 60_000;
    this.retryMs = d.retryAfterFailMs ?? 60 * 60_000;
  }

  /** 지금 압축할 때가 된 스레드들(오래 쉰 것부터) */
  due(): string[] {
    const t = this.now().getTime();
    return this.d.threadIds()
      .flatMap((id) => {
        if (this.inFlight.has(id) || this.d.busy(id)) return [];
        const msgs = this.d.messages(id);
        const c = countable(msgs);
        if (c.length === 0) return [];
        const last = new Date(c.at(-1)!.at).getTime();
        if (t - last < this.idleMs) return [];
        if (isCurrent(this.d.memory(id), msgs)) return [];
        const b = basedOnOf(msgs);
        const f = this.failed.get(id);
        if (f && f.key === `${b.messages}|${b.lastAt}` && t - f.at < this.retryMs) return [];
        return [{ id, last }];
      })
      .sort((a, b) => a.last - b.last)
      .map((x) => x.id);
  }

  /** 때가 된 것 하나를 압축한다. 돌렸으면 그 스레드 id */
  async tick(): Promise<string | null> {
    const id = this.due()[0];
    if (!id) return null;
    this.inFlight.add(id);
    const b = basedOnOf(this.d.messages(id));
    const key = `${b.messages}|${b.lastAt}`;
    try {
      const r = await this.d.compress(id);
      if (!r.ok) {
        this.failed.set(id, { at: this.now().getTime(), key });
        this.d.onFail?.(id, r.error);
      } else this.failed.delete(id);
    } catch (err) {
      this.failed.set(id, { at: this.now().getTime(), key });
      this.d.onFail?.(id, (err as Error).message);
    } finally {
      this.inFlight.delete(id);
    }
    return id;
  }
}
