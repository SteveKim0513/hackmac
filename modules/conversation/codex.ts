/**
 * Codex 어댑터: `codex app-server --listen stdio://`(JSON-RPC 2.0, 한 줄에 하나)로 붙는다(조사 3절).
 * 순서(codex-cli 0.164.0 실측): initialize → initialized → thread/start|thread/resume → turn/start(응답은 ack) →
 *   item/started(agentMessage, phase는 여기 붙음) → item/agentMessage/delta → item/completed → turn/completed.
 * 승인 요청(server request)은 반드시 답해야 한다. 안 하면 턴이 멈춘다. 묻는 상대가 없으므로 전부 거절로 자동 응답하고,
 * 대신 thread를 approvalPolicy=never + sandbox=workspace-write로 연다(cwd와 /tmp 밖 쓰기·네트워크를 Seatbelt가 막는다).
 */
import { spawn } from 'node:child_process';
import { BaseConversation } from './base.ts';
import type { ConversationEvent } from './types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 서버가 묻는 요청에 줄 거절 답(스키마의 *Response 모양). 모르는 요청은 JSON-RPC 오류로 답한다 */
export const DECLINE: Record<string, unknown> = {
  'item/commandExecution/requestApproval': { decision: 'decline' },
  'item/fileChange/requestApproval': { decision: 'decline' },
  'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
  'item/tool/requestUserInput': { answers: {} },
  'mcpServer/elicitation/request': { action: 'decline' },
  'item/tool/call': { contentItems: [], success: false },
  applyPatchApproval: { decision: 'denied' },
  execCommandApproval: { decision: 'denied' },
};

const windowName = (mins: unknown, fallback: string): string => (mins === 300 ? 'five_hour' : mins === 10080 ? 'seven_day' : fallback);

/** account/rateLimits/updated → 창별 한도 */
export const codexLimits = (params: unknown): Extract<ConversationEvent, { kind: 'limit' }>[] => {
  const rl = isObj(params) && isObj(params.rateLimits) ? params.rateLimits : null;
  if (!rl) return [];
  return (['primary', 'secondary'] as const).flatMap((k) => {
    const w = rl[k];
    if (!isObj(w) || typeof w.usedPercent !== 'number') return [];
    const used = w.usedPercent / 100;
    return [{ kind: 'limit' as const, window: windowName(w.windowDurationMins, k), used, resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : null, blocked: used >= 1 }];
  });
};

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void }

export class CodexConversation extends BaseConversation {
  readonly vendor = 'codex' as const;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  /** itemId → phase(agentMessage의 phase는 delta가 아니라 item/started에 온다) */
  private readonly phases = new Map<string, 'answer' | 'commentary'>();
  private turnId: string | null = null;
  private lastErrorMessage: string | null = null;

  async start(): Promise<void> {
    if (this.alive) return;
    const child = spawn(this.o.bin, [...(this.o.prefixArgs ?? []), 'app-server', '--listen', 'stdio://', ...(this.o.extraArgs ?? [])], { cwd: this.o.cwd, env: this.o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.wire(child, (line) => this.onLine(line));
    child.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error(this.lastError || 'app-server가 끝남'));
      this.pending.clear();
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
    await this.request('initialize', { clientInfo: { name: 'hackmac', title: 'HackMac', version: '2' } });
    this.notify('initialized');
    const common = { cwd: this.o.cwd, approvalPolicy: 'never', sandbox: 'workspace-write', ...(this.o.instructions ? { developerInstructions: this.o.instructions } : {}) };
    const r = (this.session ? await this.request('thread/resume', { threadId: this.session, ...common }) : await this.request('thread/start', common)) as Obj;
    const thread = isObj(r.thread) ? r.thread : null;
    if (!thread || typeof thread.id !== 'string') throw new Error('thread 번호를 받지 못함');
    this.emit({ kind: 'ready', session: thread.id });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) });
  }

  private onLine(line: string): void {
    let m: Obj;
    try {
      const v = JSON.parse(line);
      if (!isObj(v)) return;
      m = v;
    } catch {
      return;
    }
    const hasId = typeof m.id === 'number' || typeof m.id === 'string';
    if (hasId && typeof m.method === 'string') return this.answerServer(m.id as number | string, m.method);
    if (hasId) {
      const p = this.pending.get(m.id as number);
      if (!p) return;
      this.pending.delete(m.id as number);
      if (isObj(m.error)) p.reject(new Error(String(m.error.message ?? 'JSON-RPC 오류')));
      else p.resolve(m.result);
      return;
    }
    if (typeof m.method === 'string') this.onNotification(m.method, m.params);
  }

  private answerServer(id: number | string, method: string): void {
    if (method in DECLINE) this.write({ jsonrpc: '2.0', id, result: DECLINE[method] });
    else this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `HackMac은 ${method}를 지원하지 않음` } });
  }

  private onNotification(method: string, p: unknown): void {
    if (!isObj(p)) return;
    if (method === 'item/started' && isObj(p.item)) {
      const it = p.item;
      if (it.type === 'agentMessage' && typeof it.id === 'string') this.phases.set(it.id, it.phase === 'commentary' ? 'commentary' : 'answer');
      else if (typeof it.type === 'string' && it.type !== 'userMessage' && it.type !== 'reasoning') this.emit({ kind: 'tool', name: it.type });
      return;
    }
    if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      this.emit({ kind: 'text', delta: p.delta, phase: this.phases.get(String(p.itemId)) ?? 'answer' });
      return;
    }
    if (method === 'turn/started' && isObj(p.turn) && typeof p.turn.id === 'string') {
      this.turnId = p.turn.id;
      return;
    }
    if (method === 'error' && isObj(p.error) && p.willRetry !== true) {
      this.lastErrorMessage = String(p.error.message ?? '');
      return;
    }
    if (method === 'account/rateLimits/updated') {
      for (const e of codexLimits(p)) this.emit(e);
      return;
    }
    if (method === 'turn/completed' && isObj(p.turn)) {
      const t = p.turn;
      const items = Array.isArray(t.items) ? t.items.filter(isObj) : [];
      const answer = items.filter((i) => i.type === 'agentMessage' && i.phase !== 'commentary').map((i) => String(i.text ?? '')).join('\n');
      const status = t.status;
      const err = isObj(t.error) ? String(t.error.message ?? '') : this.lastErrorMessage;
      this.turnId = null;
      this.lastErrorMessage = null;
      this.phases.clear();
      this.emit({ kind: 'turnEnd', ok: status === 'completed', text: status === 'completed' ? answer : '', error: status === 'completed' || status === 'interrupted' ? null : err || `턴이 ${String(status)}로 끝남`, interrupted: status === 'interrupted' });
    }
  }

  protected sendNow(text: string): void {
    if (!this.session) throw new Error('thread가 아직 없다');
    this.request('turn/start', { threadId: this.session, input: [{ type: 'text', text }] }).then(
      (r) => {
        if (isObj(r) && isObj(r.turn) && typeof r.turn.id === 'string') this.turnId ??= r.turn.id;
      },
      // 프로세스가 죽어 거절된 경우는 base의 close가 이미 turnEnd를 냈다
      (err: Error) => this.turnActive && this.alive && this.emit({ kind: 'turnEnd', ok: false, text: '', error: err.message, interrupted: false }),
    );
  }

  async interrupt(): Promise<void> {
    this.dropQueue();
    if (!this.turnActive || !this.alive || !this.session) return;
    const ended = new Promise<boolean>((resolve) => {
      const off = this.onEvent((e) => {
        if (e.kind === 'turnEnd') { off(); resolve(true); }
      });
      setTimeout(() => { off(); resolve(false); }, 5000).unref();
    });
    if (this.turnId) await this.request('turn/interrupt', { threadId: this.session, turnId: this.turnId }).catch(() => {});
    if (!(await ended)) await this.stop();
  }
}
