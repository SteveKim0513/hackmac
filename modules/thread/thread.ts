/**
 * 스레드 보관(계획서 12.1). 스레드 하나 = 앱 하나. 원문 대화는 지우지 않는다.
 *   <root>/<id>/thread.json    제목·엔진·세션 번호·앱 id(완성 후) — 안전 쓰기(임시 → rename)
 *   <root>/<id>/messages.jsonl 대화 한 줄에 하나, 추가만 한다
 *   <root>/<id>/work/          엔진이 일하는 폴더(앱 패키지가 여기서 만들어진다)
 *   <root>/.archive/<id>/      앱을 지우면 스레드가 가는 곳(바로 지우지 않는다)
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Vendor } from '../account/cli.ts';

export interface ThreadMeta {
  schema: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 이 스레드를 연 엔진. 진행 중 대화는 다른 회사로 넘기지 않는다(계획서 6.2) */
  vendor: Vendor | null;
  /** 엔진 세션(Claude 세션 / Codex thread) 번호. 이어 열 때 쓴다 */
  session: string | null;
  /** 완성돼 보관소에 들어간 앱 id */
  appId: string | null;
}

export interface Message {
  at: string;
  role: 'user' | 'assistant' | 'notice';
  text: string;
  /** assistant: 턴이 실패/중단됐으면 그 이유 */
  error?: string;
  interrupted?: boolean;
}

const ID_RE = /^[0-9a-f-]{36}$/;

export class ThreadStore {
  constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {
    mkdirSync(root, { recursive: true });
  }

  private dir(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`잘못된 스레드 id: ${id}`);
    return join(this.root, id);
  }

  workDir(id: string): string {
    const d = join(this.dir(id), 'work');
    mkdirSync(d, { recursive: true });
    return d;
  }

  create(title: string): ThreadMeta {
    const id = randomUUID();
    const at = this.now().toISOString();
    // '새 앱'은 modules/studio/chat.ts의 NEW_TITLE과 같아야 첫 글로 제목이 붙는다
    const meta: ThreadMeta = { schema: 1, id, title: title.trim() || '새 앱', createdAt: at, updatedAt: at, vendor: null, session: null, appId: null };
    mkdirSync(join(this.dir(id), 'work'), { recursive: true });
    this.writeMeta(meta);
    return meta;
  }

  get(id: string): ThreadMeta | null {
    try {
      return JSON.parse(readFileSync(join(this.dir(id), 'thread.json'), 'utf8')) as ThreadMeta;
    } catch {
      return null;
    }
  }

  /** 최근에 움직인 것부터 */
  list(): ThreadMeta[] {
    return readdirSync(this.root)
      .filter((n) => ID_RE.test(n))
      .map((n) => this.get(n))
      .filter((m): m is ThreadMeta => m !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  update(id: string, patch: Partial<Pick<ThreadMeta, 'title' | 'vendor' | 'session' | 'appId'>>): ThreadMeta {
    const m = this.get(id);
    if (!m) throw new Error(`없는 스레드: ${id}`);
    const next = { ...m, ...patch, updatedAt: this.now().toISOString() };
    this.writeMeta(next);
    return next;
  }

  append(id: string, msg: Omit<Message, 'at'>): Message {
    const full: Message = { at: this.now().toISOString(), ...msg };
    appendFileSync(join(this.dir(id), 'messages.jsonl'), JSON.stringify(full) + '\n');
    this.update(id, {});
    return full;
  }

  /** 깨진 줄은 건너뛴다(쓰다 꺼진 마지막 줄 등) */
  messages(id: string): Message[] {
    const f = join(this.dir(id), 'messages.jsonl');
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n').flatMap((l) => {
      if (!l.trim()) return [];
      try {
        return [JSON.parse(l) as Message];
      } catch {
        return [];
      }
    });
  }

  archive(id: string): void {
    const a = join(this.root, '.archive');
    mkdirSync(a, { recursive: true });
    renameSync(this.dir(id), join(a, id));
  }

  private writeMeta(m: ThreadMeta): void {
    const f = join(this.dir(m.id), 'thread.json');
    writeFileSync(`${f}.tmp`, JSON.stringify(m, null, 2));
    renameSync(`${f}.tmp`, f);
  }
}
