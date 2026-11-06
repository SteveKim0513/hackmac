/**
 * 작업실 채팅: 스레드마다 대화 엔진 하나를 이어 열고, 사용자 글과 엔진 답을 스레드에 쌓는다.
 *   - 스레드는 처음 연 회사(vendor)를 기억한다. 진행 중인 대화는 다른 회사로 넘기지 않는다(계획서 6.2).
 *     그 회사가 로그아웃돼 있으면 보내지 않고 이유를 돌려준다.
 *   - 엔진이 죽으면 지도에서 빼고, 다음 글이 오면 세션 번호로 이어 연다.
 *   - 화면에 보내는 사건은 엔진 사건 + 저장된 글(message) + 바쁨 상태(state).
 */
import { realpathSync } from 'node:fs';
import type { Vendor } from '../account/cli.ts';
import { createConversation as defaultCreate, type Conversation, type ConversationEvent, type ConversationOptions } from '../conversation/index.ts';
import type { Message, ThreadStore } from '../thread/thread.ts';

export type ChatEvent = ConversationEvent | { kind: 'message'; message: Message } | { kind: 'state'; busy: boolean };

export interface EngineHandle { bin: string; env: Record<string, string> }

export interface ChatDeps {
  threads: ThreadStore;
  /** 지금 기본 엔진(새 스레드가 쓸 회사). 없으면 null */
  defaultVendor: () => Vendor | null;
  /** 그 회사의 지금 쓰는 계정 id(새 스레드가 쓴다) */
  activeAccount: (vendor: Vendor) => string;
  /** 사용자에게 보일 계정 이름 */
  accountLabel: (accountId: string) => string;
  /** 그 계정으로 CLI를 쓸 수 있으면 실행 정보(그 계정의 설정 폴더 환경 포함), 로그인 안 돼 있으면 null */
  engineFor: (vendor: Vendor, accountId: string) => EngineHandle | null;
  /** 진행 중인 대화를 다른 계정으로 옮길 때 세션 기록을 복사한다(modules/account/session.ts) */
  copySession: (vendor: Vendor, fromAccountId: string, toAccountId: string, session: string) => { ok: true } | { ok: false; detail: string };
  instructions: string;
  allowedTools?: string[];
  /** 회사·스레드별로 더 줄 것(제작 명령 env, Claude 샌드박스 설정 등). 마지막에 덮어쓴다. env는 합친다 */
  optionsFor?: (vendor: Vendor, threadId: string, cwd: string) => Partial<ConversationOptions>;
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
  /**
   * 세션을 이어 열었지만 아직 엔진이 "열렸다"(ready)고 알리지 않은 것. Claude는 첫 글을 받아야 세션 번호를 내므로,
   * 없는 세션으로 이어 열면 프로세스가 첫 글에서야 죽는다(`No conversation found`). 그 경우 새 대화로 다시 보낸다.
   */
  private readonly unverified = new Map<Conversation, { text: string | null }>();

  constructor(private readonly d: ChatDeps) {}

  /** 어느 스레드든 엔진이 일하는 중인가(유지보수 팀 호출을 미루는 데 쓴다) */
  anyBusy(): boolean {
    return [...this.live.values()].some((c) => c.busy);
  }

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
    const accountId = meta.account ?? this.d.activeAccount(vendor);
    const engine = this.d.engineFor(vendor, accountId);
    if (!engine) {
      const name = `${VENDOR_NAME[vendor]} ${this.d.accountLabel(accountId)}`;
      return { ok: false, reason: `이 앱은 ${name}(으)로 만들기 시작했어요. 그 계정에 다시 로그인하거나, 위에서 같은 회사의 다른 계정으로 옮겨 주세요` };
    }

    let conv = this.live.get(threadId);
    if (!conv || !conv.alive) {
      try {
        conv = await this.open(threadId, vendor, engine, meta.session);
      } catch (err) {
        return { ok: false, reason: `엔진을 열지 못했어요: ${(err as Error).message}` };
      }
    }
    if (!meta.vendor || !meta.account) this.d.threads.update(threadId, { vendor, account: accountId });
    // 제목을 따로 묻지 않는다: 첫 글의 앞부분이 제목이 된다(나중에 요구 정리가 끝나면 앱 이름으로 바뀐다)
    if (meta.title === NEW_TITLE && this.d.threads.messages(threadId).length === 0) this.d.threads.update(threadId, { title: titleFrom(body) });
    const msg = this.d.threads.append(threadId, { role: 'user', text: body });
    this.d.onEvent(threadId, { kind: 'message', message: msg });
    conv.send(body);
    const u = this.unverified.get(conv);
    if (u && u.text === null) u.text = body;
    this.d.onEvent(threadId, { kind: 'state', busy: true });
    return { ok: true };
  }

  private async open(threadId: string, vendor: Vendor, engine: EngineHandle, resume: string | null): Promise<Conversation> {
    try {
      return await this.openOnce(threadId, vendor, engine, resume);
    } catch (err) {
      if (!resume) throw err;
      // 이어 열기가 안 됐다(세션 기록이 이 계정 폴더에 없거나 못 읽는다). 새 대화로 시작하되 사용자에게 알린다
      this.d.threads.update(threadId, { session: null });
      this.notice(threadId, '이전 대화의 맥락을 이어 열지 못해 새 대화로 시작해요. 지금까지 나눈 글은 그대로 남아 있어요.');
      return this.openOnce(threadId, vendor, engine, null);
    }
  }

  private async openOnce(threadId: string, vendor: Vendor, engine: EngineHandle, resume: string | null): Promise<Conversation> {
    const create = this.d.create ?? defaultCreate;
    // 실제 경로로 넘긴다: Claude의 Write(./**) 규칙은 링크가 낀 경로(/var → /private/var)에서 작업 폴더 안 쓰기까지 막았다(실측)
    const cwd = realpathSync(this.d.threads.workDir(threadId));
    const extra = this.d.optionsFor?.(vendor, threadId, cwd) ?? {};
    const conv = create(vendor, {
      bin: engine.bin,
      cwd,
      ...(resume ? { resume } : {}),
      instructions: this.d.instructions,
      ...(this.d.allowedTools ? { allowedTools: this.d.allowedTools } : {}),
      ...extra,
      env: { ...engine.env, ...(extra.env ?? {}) },
    });
    if (resume) this.unverified.set(conv, { text: null });
    conv.onEvent((e) => this.onEngine(threadId, conv, e));
    this.live.set(threadId, conv);
    try {
      await conv.start();
    } catch (err) {
      this.unverified.delete(conv);
      if (this.live.get(threadId) === conv) this.live.delete(threadId);
      await conv.stop().catch(() => {});
      throw err;
    }
    return conv;
  }

  private notice(threadId: string, text: string): void {
    const msg = this.d.threads.append(threadId, { role: 'notice', text });
    this.d.onEvent(threadId, { kind: 'message', message: msg });
  }

  /**
   * 같은 회사 안에서 스레드의 계정을 옮긴다(수동). 일하는 중이면 안 된다. 진행 중이던 대화는 세션 기록을 복사해 이어 열고,
   * 복사하지 못하면 세션을 비워 새 대화로 시작하게 한다(글은 그대로, 맥락만 끊긴다) — 조용히 하지 않고 알린다.
   */
  async moveAccount(threadId: string, toAccountId: string): Promise<SendResult> {
    const meta = this.d.threads.get(threadId);
    if (!meta) return { ok: false, reason: '없는 스레드' };
    if (!meta.vendor) return { ok: false, reason: '아직 시작하지 않은 대화예요. 첫 글을 보내기 전에는 홈에서 쓸 계정을 고르면 돼요' };
    if (this.busy(threadId)) return { ok: false, reason: '답을 쓰는 중에는 계정을 바꿀 수 없어요. 멈춘 뒤에 바꿔 주세요' };
    const from = meta.account ?? this.d.activeAccount(meta.vendor);
    if (from === toAccountId) return { ok: true };
    if (!toAccountId.startsWith(`${meta.vendor}-`)) return { ok: false, reason: `이 앱은 ${VENDOR_NAME[meta.vendor]}로 만들고 있어서, 같은 회사의 계정으로만 옮길 수 있어요` };
    if (!this.d.engineFor(meta.vendor, toAccountId)) return { ok: false, reason: `${this.d.accountLabel(toAccountId)}에 로그인돼 있지 않아요` };
    await this.close(threadId);
    let how = '';
    if (meta.session) {
      const r = this.d.copySession(meta.vendor, from, toAccountId, meta.session);
      if (r.ok) how = '진행 중이던 대화도 그대로 이어져요.';
      else {
        this.d.threads.update(threadId, { session: null });
        how = '이전 대화의 맥락은 옮기지 못해 새 대화로 시작해요. 지금까지 나눈 글은 그대로 남아 있어요.';
      }
    }
    this.d.threads.update(threadId, { account: toAccountId });
    this.notice(threadId, `쓰는 계정을 바꿨어요: ${this.d.accountLabel(toAccountId)}. ${how}`.trim());
    return { ok: true };
  }

  private onEngine(threadId: string, conv: Conversation, e: ConversationEvent): void {
    if (e.kind === 'ready') {
      this.unverified.delete(conv);
      this.d.threads.update(threadId, { session: e.session });
    }
    if (e.kind === 'text' && e.phase === 'answer') this.partial.set(threadId, (this.partial.get(threadId) ?? '') + e.delta);
    this.d.onEvent(threadId, e);
    // 이어 열기가 아직 확인되지 않은 엔진의 실패는 말풍선으로 남기지 않는다 — 곧 새 대화로 다시 보낸다(exit에서)
    if (e.kind === 'turnEnd' && !e.ok && this.unverified.has(conv)) {
      this.partial.delete(threadId);
      return;
    }
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
    if (e.kind === 'exit' && !e.expected) {
      const u = this.unverified.get(conv);
      this.unverified.delete(conv);
      if (u) void this.retryFresh(threadId, u.text);
    }
  }

  /** 이어 열기가 안 됐을 때: 세션을 비우고 같은 글을 새 대화로 다시 보낸다. 글 기록과 알림은 남긴다 */
  private async retryFresh(threadId: string, text: string | null): Promise<void> {
    this.d.threads.update(threadId, { session: null });
    this.notice(threadId, '이전 대화의 맥락을 이어 열지 못해 새 대화로 시작해요. 지금까지 나눈 글은 그대로 남아 있어요.');
    const meta = this.d.threads.get(threadId);
    const vendor = meta?.vendor;
    const engine = vendor ? this.d.engineFor(vendor, meta.account ?? this.d.activeAccount(vendor)) : null;
    if (!meta || !vendor || !engine || text === null) {
      this.d.onEvent(threadId, { kind: 'state', busy: false });
      return;
    }
    try {
      const conv = await this.openOnce(threadId, vendor, engine, null);
      conv.send(text);
      this.d.onEvent(threadId, { kind: 'state', busy: true });
    } catch (err) {
      const msg = this.d.threads.append(threadId, { role: 'assistant', text: '', error: `엔진을 열지 못했어요: ${(err as Error).message}` });
      this.d.onEvent(threadId, { kind: 'message', message: msg });
      this.d.onEvent(threadId, { kind: 'state', busy: false });
    }
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
