/**
 * 사건 원장: 추가 전용 JSONL. 실행기·감시자·유지보수 팀이 남기는 사건(죽음·재시작·자원 초과·권한 거부·검증 결과·자동 수정)이
 * 모두 여기로 온다(기획 11.1). 줄마다 {at, kind, ...}. 읽는 쪽은 꼴을 따져 읽는다(깨진 줄은 건너뛴다).
 *
 * 쓰기는 한 줄 append + fsync. 날짜별 파일(<root>/<YYYY-MM-DD>.jsonl)이라 오래된 것을 지우기 쉽다.
 */
import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface LedgerEvent { at: string; kind: string; appId?: string; [k: string]: unknown }

const pad = (n: number): string => String(n).padStart(2, '0');
const dayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export class Ledger {
  constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {
    mkdirSync(root, { recursive: true });
  }

  append(event: Omit<LedgerEvent, 'at'> & { at?: string }): LedgerEvent {
    const d = this.now();
    const full: LedgerEvent = { at: d.toISOString(), ...event } as LedgerEvent;
    const path = join(this.root, `${dayOf(d)}.jsonl`);
    const line = JSON.stringify(full) + '\n';
    appendFileSync(path, line);
    const fd = openSync(path, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    return full;
  }

  /** 최근 n일치를 오래된 것부터. 깨진 줄은 건너뛴다 */
  read({ days = 7, appId, kind }: { days?: number; appId?: string; kind?: string } = {}): LedgerEvent[] {
    const cutoff = new Date(this.now().getTime() - days * 86_400_000);
    const files = readdirSync(this.root)
      .map((f) => DAY_RE.exec(f)?.[1])
      .filter((d): d is string => d !== undefined && new Date(`${d}T00:00:00`) >= new Date(`${dayOf(cutoff)}T00:00:00`))
      .sort();
    const out: LedgerEvent[] = [];
    for (const day of files) {
      for (const line of readFileSync(join(this.root, `${day}.jsonl`), 'utf8').split('\n')) {
        if (!line) continue;
        let e: unknown;
        try { e = JSON.parse(line); } catch { continue; }
        if (typeof e !== 'object' || e === null || typeof (e as LedgerEvent).at !== 'string' || typeof (e as LedgerEvent).kind !== 'string') continue;
        const ev = e as LedgerEvent;
        if (appId !== undefined && ev.appId !== appId) continue;
        if (kind !== undefined && ev.kind !== kind) continue;
        out.push(ev);
      }
    }
    return out;
  }

  /** keepDays보다 오래된 날짜 파일을 지운다 */
  prune(keepDays: number): void {
    const cutoff = dayOf(new Date(this.now().getTime() - keepDays * 86_400_000));
    for (const f of readdirSync(this.root)) {
      const day = DAY_RE.exec(f)?.[1];
      if (day && day < cutoff) rmSync(join(this.root, f), { force: true });
    }
  }
}
