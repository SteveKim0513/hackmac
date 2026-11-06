/**
 * 작업실 채팅: 스레드마다 대화 엔진 하나를 이어 열고, 사용자 글과 엔진 답을 스레드에 쌓는다.
 *   - 스레드는 처음 연 회사(vendor)를 기억한다. 진행 중인 대화는 다른 회사로 넘기지 않는다(계획서 6.2).
 *     그 회사가 로그아웃돼 있으면 보내지 않고 이유를 돌려준다.
 *   - 엔진이 죽으면 지도에서 빼고, 다음 글이 오면 세션 번호로 이어 연다.
 *   - 화면에 보내는 사건은 엔진 사건 + 저장된 글(message) + 바쁨 상태(state).
 */
import type { Vendor } from '../account/cli.ts';
import { createConversation as defaultCreate, type Conversation, type ConversationEvent, type ConversationOptions } from '../conversation/index.ts';
import type { Message, ThreadStore } from '../thread/thread.ts';

export type ChatEvent = ConversationEvent | { kind: 'message'; message: Message } | { kind: 'state'; busy: boolean };

export interface EngineHandle { bin: string; env: Record<string, string> }

export interface ChatDeps {
  threads: ThreadStore;
  /** 지금 기본 엔진(새 스레드가 쓸 회사). 없으면 null */
  defaultVendor: () => Vendor | null;
  /** 그 회사 CLI를 쓸 수 있으면 실행 정보, 로그인 안 돼 있으면 null */
  engineFor: (vendor: Vendor) => EngineHandle | null;
  instructions: string;
  allowedTools?: string[];
  onEvent: (threadId: string, e: ChatEvent) => void;
  create?: (vendor: Vendor, o: ConversationOptions) => Conversation;
}

export type SendResult = { ok: true } | { ok: false; reason: string };

const VENDOR_NAME: Record<Vendor, string> = { claude: 'Claude', codex: 'ChatGPT(Codex)' };
export const NEW_TITLE = '새 앱';
/** 첫 줄 앞 24자. 넘치면 말줄임 */
export const titleFrom = (text: string): string => {
  const line = text.trim().split('\n')[0].trim();
  return line.length > 24 ? `${line.slice(0, 24).trimEnd()}…` : line || NEW_TITLE;
};

export class Chats {
  private readonly live = new Map<string, Conversation>();
  /** 이번 턴에 흘러온 답 조각(결과 글이 비어 있을 때 대신 쓴다) */
  private readonly partial = new Map<string, string>();

  constructor(private readonly d: ChatDeps) {}

  busy(threadId: string): boolean {
    return this.live.get(threadId)?.busy ?? false;
  }

  async send(threadId: string, text: string): Promise<SendResult> {
    const body = text.trim();
    if (!body) return { ok: false, reason: '빈 글' };
    const meta = this.d.threads.get(threadId);
    if (!meta) return { ok: false, reason: '없는 스레드' };
    const vendor = meta.vendor ?? this.d.defaultVendor();
    if (!vendor) return { ok: false, reason: '로그인한 엔진이 없어요' };
    const engine = this.d.engineFor(vendor);
    if (!engine) return { ok: false, reason: `이 앱은 ${VENDOR_NAME[vendor]}로 만들기 시작했어요. ${VENDOR_NAME[vendor]}에 다시 로그인해야 이어갈 수 있어요` };

    let conv = this.live.get(threadId);
    if (!conv || !conv.alive) {
      try {
        conv = await this.open(threadId, vendor, engine, meta.session);
      } catch (err) {
        return { ok: false, reason: `엔진을 열지 못했어요: ${(err as Error).message}` };
      }
    }
    if (!meta.vendor) this.d.threads.update(threadId, { vendor });
    // 제목을 따로 묻지 않는다: 첫 글의 앞부분이 제목이 된다(나중에 요구 정리가 끝나면 앱 이름으로 바뀐다)
    if (meta.title === NEW_TITLE && this.d.threads.messages(threadId).length === 0) this.d.threads.update(threadId, { title: titleFrom(body) });
    const msg = this.d.threads.append(threadId, { role: 'user', text: body });
    this.d.onEvent(threadId, { kind: 'message', message: msg });
    conv.send(body);
    this.d.onEvent(threadId, { kind: 'state', busy: true });
    return { ok: true };
  }

  private async open(threadId: string, vendor: Vendor, engine: EngineHandle, resume: string | null): Promise<Conversation> {
    const create = this.d.create ?? defaultCreate;
    const conv = create(vendor, {
      bin: engine.bin,
      cwd: this.d.threads.workDir(threadId),
      env: engine.env,
      ...(resume ? { resume } : {}),
      instructions: this.d.instructions,
      ...(this.d.allowedTools ? { allowedTools: this.d.allowedTools } : {}),
    });
    conv.onEvent((e) => this.onEngine(threadId, conv, e));
    this.live.set(threadId, conv);
    await conv.start();
    return conv;
  }

  private onEngine(threadId: string, conv: Conversation, e: ConversationEvent): void {
    if (e.kind === 'ready') this.d.threads.update(threadId, { session: e.session });
    if (e.kind === 'text' && e.phase === 'answer') this.partial.set(threadId, (this.partial.get(threadId) ?? '') + e.delta);
    this.d.onEvent(threadId, e);
    if (e.kind === 'turnEnd') {
      const streamed = this.partial.get(threadId) ?? '';
      this.partial.delete(threadId);
      const text = e.text || streamed;
      const msg = this.d.threads.append(threadId, { role: 'assistant', text, ...(e.error ? { error: e.error } : {}), ...(e.interrupted ? { interrupted: true } : {}) });
      this.d.onEvent(threadId, { kind: 'message', message: msg });
      // turnEnd 직후엔 줄 선 다음 글이 이미 보내졌을 수 있다 → 엔진의 busy를 그대로 알린다
      this.d.onEvent(threadId, { kind: 'state', busy: conv.busy });
    }
    if (e.kind === 'exit' && this.live.get(threadId) === conv) this.live.delete(threadId);
  }

  async interrupt(threadId: string): Promise<void> {
    await this.live.get(threadId)?.interrupt();
  }

  async close(threadId: string): Promise<void> {
    const c = this.live.get(threadId);
    this.live.delete(threadId);
    await c?.stop();
  }

  async stopAll(): Promise<void> {
    const all = [...this.live.values()];
    this.live.clear();
    await Promise.all(all.map((c) => c.stop()));
  }
}
