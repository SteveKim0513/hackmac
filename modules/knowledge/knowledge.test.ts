import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeStore } from './knowledge.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hackmac-know-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('KnowledgeStore', () => {
  it('쌓이고, 최근 것부터 돌려주고, 같은 글은 다시 넣지 않는다', () => {
    const k = new KnowledgeStore(join(dir, 'k.jsonl'));
    expect(k.add('pitfall', 'Calendar 날짜 범위 필터는 20초 넘게 걸린다', 't1')).not.toBeNull();
    expect(k.add('pitfall', '  calendar 날짜 범위   필터는 20초 넘게 걸린다 ', 't2')).toBeNull();
    k.add('preference', '회의 중에는 창보다 배너가 좋다', 't2');
    expect(k.recent()).toEqual(['(사용자 취향) 회의 중에는 창보다 배너가 좋다', 'Calendar 날짜 범위 필터는 20초 넘게 걸린다']);
    expect(k.recent(5, 'pitfall')).toEqual(['Calendar 날짜 범위 필터는 20초 넘게 걸린다']);
  });
  it('너무 짧은 글은 버린다', () => {
    expect(new KnowledgeStore(join(dir, 'k.jsonl')).add('pitfall', '짧음', 't')).toBeNull();
  });
  it('깨진 줄은 건너뛴다', () => {
    const f = join(dir, 'k.jsonl');
    writeFileSync(f, '{깨짐\n');
    const k = new KnowledgeStore(f);
    k.add('pitfall', '시험 스크립트에서 osascript를 쓰면 게이트가 막는다', 't');
    appendFileSync(f, 'null\n');
    expect(k.list()).toHaveLength(1);
  });
});
