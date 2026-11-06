/** 두 어댑터가 함께 쓰는 것: 듣는 쪽 목록, 일하는 중 글 줄 세우기, 표준 오류 끝, 줄 단위 읽기 */
import type { ChildProcess } from 'node:child_process';
import type { Vendor } from '../account/cli.ts';
import type { Conversation, ConversationEvent, ConversationOptions } from './types.ts';

export abstract class BaseConversation implements Conversation {
  abstract readonly vendor: Vendor;
  session: string | null;
  protected child: ChildProcess | null = null;
  protected turnActive = false;
  protected stopping = false;
  private readonly queue: string[] = [];
  private readonly listeners = new Set<(e: ConversationEvent) => void>();
  private errTail = '';

  constructor(protected readonly o: ConversationOptions) {
    this.session = o.resume ?? null;
  }

  get busy(): boolean {
    return this.turnActive || this.queue.length > 0;
  }

  get alive(): boolean {
    return this.child !== null && this.child.exitCode === null && this.child.signalCode === null;
  }

  get lastError(): string {
    return this.errTail.trim();
  }

  onEvent(cb: (e: ConversationEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected emit(e: ConversationEvent): void {
    if (e.kind === 'ready') this.session = e.session;
    for (const cb of this.listeners) cb(e);
    if (e.kind === 'turnEnd') {
      this.turnActive = false;
      const next = this.queue.shift();
      if (next !== undefined) this.dispatch(next);
    }
  }

  send(text: string): void {
    if (!this.alive) throw new Error('엔진이 떠 있지 않다');
    if (this.turnActive) this.queue.push(text);
    else this.dispatch(text);
  }

  private dispatch(text: string): void {
    this.turnActive = true;
    this.sendNow(text);
  }

  protected dropQueue(): void {
    this.queue.length = 0;
  }

  /** 어댑터가 실제로 글 하나를 보낸다(턴 시작) */
  protected abstract sendNow(text: string): void;
  abstract start(): Promise<void>;
  abstract interrupt(): Promise<void>;

  /** 프로세스를 붙인다: 표준 출력은 줄마다 onLine, 표준 오류는 끝 500자만 남긴다, 끝나면 exit */
  protected wire(child: ChildProcess, onLine: (line: string) => void): void {
    this.child = child;
    this.stopping = false;
    this.errTail = '';
    let buf = '';
    child.stdin?.on('error', () => {});
    child.stderr?.on('data', (c: Buffer) => {
      this.errTail = (this.errTail + c.toString('utf8')).slice(-500);
    });
    child.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) onLine(line);
      }
    });
    child.on('error', (err) => {
      this.errTail = (this.errTail + String(err.message)).slice(-500);
    });
    child.on('close', (code, signal) => {
      if (buf.trim()) onLine(buf.trim());
      buf = '';
      const expected = this.stopping;
      // 줄 선 글을 먼저 버린다. 아니면 아래 turnEnd가 다음 글을 죽은 프로세스로 보내려 한다
      this.dropQueue();
      if (this.turnActive) this.emit({ kind: 'turnEnd', ok: false, text: '', error: expected ? null : this.lastError || `엔진이 끝남(코드 ${code ?? signal})`, interrupted: expected });
      this.emit({ kind: 'exit', code, signal: signal ?? null, expected });
    });
  }

  async stop(graceMs = 2000): Promise<void> {
    const c = this.child;
    if (!c || !this.alive) return;
    this.stopping = true;
    this.dropQueue();
    await new Promise<void>((resolve) => {
      c.once('close', () => resolve());
      c.kill('SIGTERM');
      setTimeout(() => {
        if (this.child === c && this.alive) c.kill('SIGKILL');
      }, graceMs).unref();
    });
  }

  protected write(obj: unknown): void {
    if (!this.child?.stdin?.writable) throw new Error('엔진이 떠 있지 않다');
    this.child.stdin.write(JSON.stringify(obj) + '\n');
  }
}
