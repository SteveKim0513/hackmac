/**
 * Claude 어댑터: `claude -p --input-format stream-json --output-format stream-json`을 장수 프로세스로 띄우고 글을 한 줄씩 넣는다
 * (VS Code 확장·스튜디오 src/engine.ts와 같은 방식). 묻는 상대가 없으므로 dontAsk: allowedTools 밖의 도구는 거부된다.
 * 중단은 stream-json의 control_request(interrupt). 5초 안에 턴이 안 끝나면 프로세스를 끊는다(세션은 resume으로 이어 연다).
 */
import { spawn } from 'node:child_process';
import { BaseConversation } from './base.ts';
import type { ConversationEvent } from './types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** rate_limit_event의 rate_limit_info를 창별 한도로. 창마다 unifiedWindows에 오거나, 알림 자체가 창 하나를 말한다 */
export const claudeLimits = (raw: unknown): Extract<ConversationEvent, { kind: 'limit' }>[] => {
  const info = isObj(raw) ? raw.rate_limit_info : null;
  if (!isObj(info)) return [];
  const one = (window: string, w: Obj, status: unknown): Extract<ConversationEvent, { kind: 'limit' }> => {
    const u = num(w.utilization);
    const r = num(w.resetsAt);
    return { kind: 'limit', window, used: u === null ? null : u > 1 ? u / 100 : u, resetsAt: r === null ? null : r < 1e12 ? r * 1000 : r, blocked: status === 'rejected' };
  };
  if (isObj(info.unifiedWindows)) {
    return Object.entries(info.unifiedWindows).filter(([, w]) => isObj(w)).map(([k, w]) => one(k, w as Obj, (w as Obj).status ?? info.status));
  }
  return [one(typeof info.rateLimitType === 'string' && info.rateLimitType ? info.rateLimitType : 'unknown', info, info.status)];
};

/** stream-json 한 줄을 공통 사건으로. 형식이 바뀌어도 여기만 고친다. 팀원(서브에이전트) 안쪽 글은 버린다 */
export const parseClaudeLine = (line: string): ConversationEvent[] => {
  let o: unknown;
  try {
    o = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isObj(o)) return [];
  if (o.type === 'system' && o.subtype === 'init' && typeof o.session_id === 'string') return [{ kind: 'ready', session: o.session_id }];
  if (o.type === 'rate_limit_event') return claudeLimits(o);
  const nested = typeof o.parent_tool_use_id === 'string' && o.parent_tool_use_id !== '';
  if (o.type === 'stream_event' && isObj(o.event) && !nested) {
    const ev = o.event;
    if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'text_delta' && typeof ev.delta.text === 'string') return [{ kind: 'text', delta: ev.delta.text, phase: 'answer' }];
    if (ev.type === 'content_block_start' && isObj(ev.content_block) && ev.content_block.type === 'tool_use') return [{ kind: 'tool', name: String(ev.content_block.name ?? '') }];
    return [];
  }
  if (o.type === 'result') {
    const ok = o.is_error !== true;
    const text = typeof o.result === 'string' ? o.result : '';
    const errors = Array.isArray(o.errors) ? o.errors.map(String).join('; ') : '';
    return [{ kind: 'turnEnd', ok, text: ok ? text : '', error: ok ? null : text || errors || String(o.subtype ?? '오류'), interrupted: false }];
  }
  return [];
};

export class ClaudeConversation extends BaseConversation {
  readonly vendor = 'claude' as const;
  private interrupting = false;
  private reqId = 0;

  async start(): Promise<void> {
    if (this.alive) return;
    const args = [
      ...(this.o.prefixArgs ?? []),
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--permission-mode', 'dontAsk',
      // 사용자의 MCP 서버를 싣지 않는다: 앱 제작이 사용자 환경에 기대지 않게, 그리고 매 턴 도구 설명 토큰을 아끼려고
      '--strict-mcp-config',
      ...(this.session ? ['--resume', this.session] : []),
      ...(this.o.allowedTools?.length ? ['--allowedTools', this.o.allowedTools.join(',')] : []),
      ...(this.o.instructions ? ['--append-system-prompt', this.o.instructions] : []),
      ...(this.o.extraArgs ?? []),
    ];
    const child = spawn(this.o.bin, args, { cwd: this.o.cwd, env: this.o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.wire(child, (line) => {
      for (const e of parseClaudeLine(line)) {
        if (e.kind === 'turnEnd' && this.interrupting) {
          this.interrupting = false;
          this.emit({ ...e, ok: false, interrupted: true, error: null });
        } else this.emit(e);
      }
    });
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', () => resolve());
      child.once('error', reject);
    });
  }

  protected sendNow(text: string): void {
    this.write({ type: 'user', message: { role: 'user', content: text } });
  }

  async interrupt(): Promise<void> {
    this.dropQueue();
    if (!this.turnActive || !this.alive) return;
    this.interrupting = true;
    const ended = new Promise<boolean>((resolve) => {
      const off = this.onEvent((e) => {
        if (e.kind === 'turnEnd') { off(); resolve(true); }
      });
      setTimeout(() => { off(); resolve(false); }, 5000).unref();
    });
    this.write({ type: 'control_request', request_id: `hackmac-${++this.reqId}`, request: { subtype: 'interrupt' } });
    if (!(await ended)) await this.stop();
  }
}
