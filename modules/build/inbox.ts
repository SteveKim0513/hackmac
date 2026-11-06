/**
 * `$HACKMAC_BUILD` 명령(에이전트) ↔ HackMac의 통로. 작업 폴더 안의 파일로 주고받는다.
 *   요청: <work>/.hackmac/inbox/<id>.json   {id, cmd, args}
 *   응답: <work>/.hackmac/outbox/<id>.json  {ok, text, data?}
 * 소켓이 아니라 파일인 이유: Codex 샌드박스는 작업 폴더와 /tmp 밖 쓰기와 네트워크를 막는다. 작업 폴더 안 파일은 두 엔진 모두에서 된다.
 * 요청은 신뢰 경계를 넘어온 것이다 — 모양을 따져 읽고, 처리기는 HackMac 코드가 정한 일만 한다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InboxRequest { id: string; cmd: string; args: Record<string, unknown> }
export interface InboxResponse { ok: boolean; text: string; data?: unknown }
export type Handler = (req: InboxRequest) => Promise<InboxResponse> | InboxResponse;

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export class BuildInbox {
  readonly inbox: string;
  readonly outbox: string;
  private timer: NodeJS.Timeout | null = null;
  private readonly inFlight = new Set<string>();

  constructor(dir: string, private readonly handle: Handler) {
    this.inbox = join(dir, 'inbox');
    this.outbox = join(dir, 'outbox');
    mkdirSync(this.inbox, { recursive: true });
    mkdirSync(this.outbox, { recursive: true });
  }

  /** 들어온 요청을 한 번 훑는다. 시험은 직접 부르고, 실제로는 start()가 주기적으로 부른다 */
  async poll(): Promise<number> {
    let names: string[];
    try {
      names = readdirSync(this.inbox).filter((n) => n.endsWith('.json'));
    } catch {
      return 0;
    }
    const jobs: Promise<void>[] = [];
    for (const name of names) {
      const id = name.slice(0, -5);
      if (this.inFlight.has(id)) continue;
      this.inFlight.add(id);
      jobs.push(this.one(id, join(this.inbox, name)).finally(() => this.inFlight.delete(id)));
    }
    await Promise.all(jobs);
    return jobs.length;
  }

  private async one(id: string, file: string): Promise<void> {
    let req: InboxRequest | null = null;
    let res: InboxResponse;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      if (!ID_RE.test(id) || raw.id !== id || typeof raw.cmd !== 'string') throw new Error('요청 모양이 틀림');
      req = { id, cmd: raw.cmd, args: typeof raw.args === 'object' && raw.args !== null ? (raw.args as Record<string, unknown>) : {} };
    } catch (err) {
      // CLI는 <id>.json.tmp에 다 쓴 뒤 이름을 바꿔 넣는다 → 여기 보이는 파일은 완성본이다. 못 읽으면 다시 봐도 못 읽는다
      res = { ok: false, text: err instanceof SyntaxError ? '요청 JSON을 읽을 수 없음' : (err as Error).message };
      this.respond(id, res);
      rmSync(file, { force: true });
      return;
    }
    rmSync(file, { force: true });
    try {
      res = await this.handle(req);
    } catch (err) {
      res = { ok: false, text: `HackMac 처리 중 오류: ${(err as Error).message}` };
    }
    this.respond(id, res);
  }

  private respond(id: string, res: InboxResponse): void {
    if (!ID_RE.test(id)) return;
    const f = join(this.outbox, `${id}.json`);
    writeFileSync(`${f}.tmp`, JSON.stringify(res));
    renameSync(`${f}.tmp`, f);
  }

  start(intervalMs = 250): void {
    if (this.timer) return;
    let busy = false;
    this.timer = setInterval(() => {
      if (busy || !existsSync(this.inbox)) return;
      busy = true;
      void this.poll().finally(() => { busy = false; });
    }, intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
