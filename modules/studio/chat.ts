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
  /** 기억(계획서 12.2)이 최신이면 새 세션에 넣을 글. null이면 평소처럼 세션을 이어 연다 */
  memoryContext?: (threadId: string) => string | null;
  /** 엔진을 열 때마다 지시 뒤에 붙일 것(배운 것, 수정 중인 앱의 사정 등). null이면 없음 */
  context?: (threadId: string) => string | null;
  /** 레시피(12.3)를 붙여넣은 첫 글이면 빈칸만 채우는 짧은 모드로 간다 */
  recipe?: { detect: (text: string) => boolean; instructions: string; title: (text: string) => string | null };
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

    const isFirst = this.d.threads.messages(threadId).length === 0;
    // 레시피를 붙여넣은 첫 글이면 이 스레드는 짧은 모드다(다시 열어도 유지)
    if (!meta.recipe && isFirst && this.d.recipe?.detect(body)) {
      meta.recipe = true;
      this.d.threads.update(threadId, { recipe: true });
    }
    let conv = this.live.get(threadId);
    let usedMemory = false;
    if (!conv || !conv.alive) {
      const x = this.extras(threadId, meta.recipe === true);
      usedMemory = x.usedMemory;
      // 기억이 최신이면 --resume 대신 새 세션에 기억을 넣는다(계획서 12.2). 컨텍스트가 길어지지 않고 계정·회사를 바꿔도 이어진다
      if (x.usedMemory) this.d.threads.update(threadId, { session: null });
      try {
        conv = await this.open(threadId, vendor, engine, x.usedMemory ? null : meta.session, x.text);
      } catch (err) {
        return { ok: false, reason: `엔진을 열지 못했어요: ${(err as Error).message}` };
      }
    }
    if (!meta.vendor || !meta.account) this.d.threads.update(threadId, { vendor, account: accountId });
    // 제목을 따로 묻지 않는다: 첫 글의 앞부분이 제목이 된다(나중에 요구 정리가 끝나면 앱 이름으로 바뀐다). 레시피는 목표 한 줄
    if (meta.title === NEW_TITLE && isFirst) this.d.threads.update(threadId, { title: (meta.recipe && this.d.recipe?.title(body)) || titleFrom(body) });
    if (usedMemory) this.notice(threadId, '이 앱의 기억을 불러와서 이어 갈게요. 지금까지 나눈 글은 그대로 남아 있어요.');
    const msg = this.d.threads.append(threadId, { role: 'user', text: body });
    this.d.onEvent(threadId, { kind: 'message', message: msg });
    conv.send(body);
    const u = this.unverified.get(conv);
    if (u && u.text === null) u.text = body;
    this.d.onEvent(threadId, { kind: 'state', busy: true });
    return { ok: true };
  }

  private async open(threadId: string, vendor: Vendor, engine: EngineHandle, resume: string | null, addendum: string): Promise<Conversation> {
    try {
      return await this.openOnce(threadId, vendor, engine, resume, addendum);
    } catch (err) {
      if (!resume) throw err;
      // 이어 열기가 안 됐다(세션 기록이 이 계정 폴더에 없거나 못 읽는다). 새 대화로 시작하되 사용자에게 알린다
      this.d.threads.update(threadId, { session: null });
      this.notice(threadId, '이전 대화의 맥락을 이어 열지 못해 새 대화로 시작해요. 지금까지 나눈 글은 그대로 남아 있어요.');
      return this.openOnce(threadId, vendor, engine, null, addendum);
    }
  }

  /** 지시문 뒤에 붙일 것: 레시피 모드 지시 + (최신이면) 기억 */
  private extras(threadId: string, recipe: boolean): { text: string; usedMemory: boolean } {
    const mem = this.d.memoryContext?.(threadId) ?? null;
    const ctx = this.d.context?.(threadId) ?? null;
    return { text: [recipe && this.d.recipe ? this.d.recipe.instructions : '', ctx ?? '', mem ?? ''].filter(Boolean).join('\n\n'), usedMemory: mem !== null };
  }

  private async openOnce(threadId: string, vendor: Vendor, engine: EngineHandle, resume: string | null, addendum: string): Promise<Conversation> {
    const create = this.d.create ?? defaultCreate;
    // 실제 경로로 넘긴다: Claude의 Write(./**) 규칙은 링크가 낀 경로(/var → /private/var)에서 작업 폴더 안 쓰기까지 막았다(실측)
    const cwd = realpathSync(this.d.threads.workDir(threadId));
    const extra = this.d.optionsFor?.(vendor, threadId, cwd) ?? {};
    const conv = create(vendor, {
      bin: engine.bin,
      cwd,
      ...(resume ? { resume } : {}),
      instructions: addendum ? `${this.d.instructions}\n\n${addendum}` : this.d.instructions,
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
      const conv = await this.openOnce(threadId, vendor, engine, null, this.extras(threadId, meta.recipe === true).text);
      conv.send(text);
      this.d.onEvent(threadId, { kind: 'state', busy: true });
    } catch (err) {
      const msg = this.d.threads.append(threadId, { role: 'assistant', text: '', error: `엔진을 열지 못했어요: ${(err as Error).message}` });
      this.d.onEvent(threadId, { kind: 'message', message: msg });
      this.d.onEvent(threadId, { kind: 'state', busy: false });
    }
  }

  /**
   * HackMac이 요구 정리 담당에게 알릴 것(제작 결과 등)을 보낸다. 사용자가 쓴 글이 아니므로 사용자 말풍선으로 남기지 않는다 —
   * 엔진의 답(사용자에게 하는 말)만 평소처럼 쌓인다. 엔진이 꺼져 있으면 이어 연다.
   */
  async relay(threadId: string, text: string): Promise<SendResult> {
    const meta = this.d.threads.get(threadId);
    if (!meta?.vendor) return { ok: false, reason: '대화를 시작하지 않은 스레드' };
    const accountId = meta.account ?? this.d.activeAccount(meta.vendor);
    const engine = this.d.engineFor(meta.vendor, accountId);
    if (!engine) return { ok: false, reason: '그 계정이 로그인돼 있지 않아요' };
    let conv = this.live.get(threadId);
    if (!conv || !conv.alive) {
      const x = this.extras(threadId, meta.recipe === true);
      if (x.usedMemory) this.d.threads.update(threadId, { session: null });
      try {
        conv = await this.open(threadId, meta.vendor, engine, x.usedMemory ? null : meta.session, x.text);
      } catch (err) {
        return { ok: false, reason: `엔진을 열지 못했어요: ${(err as Error).message}` };
      }
    }
    conv.send(text);
    this.d.onEvent(threadId, { kind: 'state', busy: true });
    return { ok: true };
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
