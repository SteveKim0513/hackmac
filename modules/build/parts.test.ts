import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASELINE_AUDIT, parseAudit } from './audit.ts';
import { readExperiments, runExperiment } from './experiment.ts';
import { parseRubric } from './rubric.ts';

const STUB = join(process.cwd(), 'resources', 'bin', 'hackmac-popup-stub');
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hackmac-parts-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseRubric', () => {
  it('요구사항마다 기준이 있어야 하고, 모르는 요구사항은 버리고, 틀린 번호는 다시 매긴다', () => {
    const r = parseRubric('잡글 {"items":[{"id":"R1.1","req":"R1","criterion":"a","how":"auto"},{"id":"X","req":"R1","criterion":"b","how":"manual"},{"id":"R9.1","req":"R9","criterion":"c"},{"id":"R2.1","req":"R2","criterion":"d"}]}', ['R1', 'R2']);
    expect(r).toEqual({ ok: true, items: [
      { id: 'R1.1', req: 'R1', criterion: 'a', how: 'auto' },
      { id: 'R1.2', req: 'R1', criterion: 'b', how: 'manual' },
      { id: 'R2.1', req: 'R2', criterion: 'd', how: 'auto' },
    ] });
  });
  it('기준이 없는 요구사항이 있으면 실패', () => {
    expect(parseRubric('{"items":[{"id":"R1.1","req":"R1","criterion":"a"}]}', ['R1', 'R2'])).toEqual({ ok: false, error: '기준이 없는 요구사항: R2' });
    expect(parseRubric('답 없음', ['R1']).ok).toBe(false);
  });
});

describe('parseAudit', () => {
  const reqs = [{ id: 'R1', text: '알림 시각을 조정할 수 있다' }];
  const all = (met: boolean) => BASELINE_AUDIT.map((b) => ({ id: b.id, met, evidence: met ? 'x.sh' : '', gap: met ? '' : '없음' }));
  it('모두 충족이면 ok', () => {
    const r = parseAudit(JSON.stringify({ goals: [{ id: 'R1', met: true, evidence: 'settings.notify-at을 schedule이 atSetting으로 읽는다', gap: '' }], baseline: all(true) }), reqs, 'codex');
    expect(r).toMatchObject({ ok: true, by: 'codex' });
    expect(r!.items).toHaveLength(1 + BASELINE_AUDIT.length);
  });
  it('빠진 항목은 미충족, 근거 없는 충족도 미충족(통과로 치지 않는다)', () => {
    const r = parseAudit(JSON.stringify({ goals: [{ id: 'R1', met: true, evidence: '', gap: '' }], baseline: all(true).slice(1) }), reqs, 'codex')!;
    expect(r.ok).toBe(false);
    expect(r.items.find((x) => x.id === 'R1')).toMatchObject({ met: false, gap: expect.stringContaining('근거가 없음') });
    expect(r.items.find((x) => x.id === 'S2')).toMatchObject({ met: false, gap: expect.stringContaining('판정하지 않았음') });
  });
  it('JSON이 없으면 null', () => {
    expect(parseAudit('좋아 보여요', reqs, 'c')).toBeNull();
  });
});

describe('후보 실험', () => {
  it('후보를 실제로 돌려 합격한 것 중 가장 빠른 것이 이긴다. 실제 앱을 건드리는 후보는 돌리지 않는다', async () => {
    const f = join(dir, 'experiments.json');
    writeFileSync(f, JSON.stringify({ experiments: [{
      question: '날짜를 어떻게 만들까', criterion: '종료 0이고 2초 안', maxMs: 2000,
      candidates: [
        { name: '느림', script: '#!/bin/zsh\nsleep 0.3\ndate +%F\n' },
        { name: '빠름', script: '#!/bin/zsh\ndate +%F\n' },
        { name: '실패', script: '#!/bin/zsh\nexit 3\n' },
        { name: '앱 건드림', script: '#!/bin/zsh\nosascript -e \'tell application "Calendar" to get name\'\n' },
      ],
    }] }));
    const specs = readExperiments(f);
    expect(specs).toHaveLength(1);
    const r = await runExperiment(specs[0]!, { pkgDir: null, popupStub: STUB });
    expect(r.winner).toBe('빠름');
    expect(r.runs.find((x) => x.name === '실패')).toMatchObject({ ok: false, note: expect.stringContaining('종료 3') });
    expect(r.runs.find((x) => x.name === '앱 건드림')).toMatchObject({ ok: false, note: expect.stringContaining('사용자 데이터 보호') });
    expect(r.runs.find((x) => x.name === '느림')!.ok).toBe(true);
  }, 30_000);
  it('시간 기준을 넘으면 불합격', async () => {
    const r = await runExperiment({ question: 'q', criterion: '0.1초 안', maxMs: 100, candidates: [{ name: 'a', script: '#!/bin/zsh\nsleep 0.4\n' }, { name: 'b', script: '#!/bin/zsh\nsleep 0.4\n' }] }, { pkgDir: null, popupStub: STUB });
    expect(r.winner).toBeNull();
    expect(r.runs[0]!.note).toContain('기준 100ms를 넘음');
  }, 30_000);
  it('파일이 없거나 후보가 하나뿐이면 실험하지 않는다', () => {
    expect(readExperiments(join(dir, 'none.json'))).toEqual([]);
    const f = join(dir, 'one.json');
    writeFileSync(f, JSON.stringify({ experiments: [{ question: 'q', candidates: [{ name: 'a', script: 'x' }] }] }));
    expect(readExperiments(f)).toEqual([]);
  });
});
