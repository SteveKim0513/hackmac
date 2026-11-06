import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ledger } from './ledger.ts';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'hackmac-ledger-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('Ledger', () => {
  it('append는 at을 붙이고 날짜 파일에 한 줄 더한다', () => {
    let t = new Date('2026-11-06T10:00:00Z');
    const l = new Ledger(tmp, () => t);
    const e = l.append({ kind: 'run.end', appId: 'a.x', code: 1 });
    expect(e.at).toBe('2026-11-06T10:00:00.000Z');
    t = new Date('2026-11-07T10:00:00Z');
    l.append({ kind: 'run.end', appId: 'b.y', code: 0 });
    expect(readdirSync(tmp).sort()).toEqual(['2026-11-06.jsonl', '2026-11-07.jsonl']);
  });

  it('read는 날짜·앱·종류로 거르고 깨진 줄은 건너뛴다', () => {
    let t = new Date('2026-11-01T10:00:00Z');
    const l = new Ledger(tmp, () => t);
    l.append({ kind: 'old', appId: 'a.x' });
    t = new Date('2026-11-06T10:00:00Z');
    l.append({ kind: 'run.end', appId: 'a.x' });
    l.append({ kind: 'run.end', appId: 'b.y' });
    appendFileSync(join(tmp, '2026-11-06.jsonl'), '{not json\n{"kind":"noat"}\n');
    l.append({ kind: 'resident.gaveup', appId: 'a.x' });
    expect(l.read({ days: 3 }).map((e) => e.kind)).toEqual(['run.end', 'run.end', 'resident.gaveup']);
    expect(l.read({ days: 30 }).map((e) => e.kind)[0]).toBe('old');
    expect(l.read({ days: 3, appId: 'a.x' }).map((e) => e.kind)).toEqual(['run.end', 'resident.gaveup']);
    expect(l.read({ kind: 'resident.gaveup' })).toHaveLength(1);
  });

  it('prune은 오래된 날짜 파일만 지운다', () => {
    let t = new Date('2026-10-01T10:00:00Z');
    const l = new Ledger(tmp, () => t);
    l.append({ kind: 'x' });
    t = new Date('2026-11-06T10:00:00Z');
    l.append({ kind: 'y' });
    l.prune(14);
    expect(readdirSync(tmp)).toEqual(['2026-11-06.jsonl']);
  });
});
