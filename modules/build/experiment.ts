/**
 * 후보 실험: 답을 하나 고르는 대신 후보를 여러 개 실제로 돌려 재고 이긴 것을 쓴다. 설계 담당이 ./spec/experiments.json에
 * 질문·합격 기준(최대 시간)·후보 스크립트를 적으면, HackMac이 검증 게이트와 같은 격리 환경(빈 가짜 홈, 기본 PATH,
 * 앱 패키지 사본)에서 후보마다 3번 돌려 성공 여부와 가운데 시간을 잰다. 합격한 후보 중 가장 빠른 것이 이긴다.
 *
 * 한계(사용자 데이터 보호): 실제 Calendar·Reminders 같은 앱을 부르는 후보는 돌리지 않는다(osascript가 있으면 건너뛴다).
 * 그래서 이 실험이 재는 것은 판단·가공·인터넷 응답처럼 격리된 곳에서 잴 수 있는 것뿐이다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExperimentResult } from './progress.ts';

export interface ExperimentSpec { question: string; criterion: string; maxMs: number; candidates: { name: string; script: string }[] }

const MAX_EXPERIMENTS = 3;
const MAX_CANDIDATES = 5;
const REPEAT = 3;

/** ./spec/experiments.json 을 따져 읽는다. 없으면 []. 틀린 항목은 버린다 */
export const readExperiments = (file: string): ExperimentSpec[] => {
  if (!existsSync(file)) return [];
  let o: unknown;
  try {
    o = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const list = (o as { experiments?: unknown }).experiments;
  if (!Array.isArray(list)) return [];
  const out: ExperimentSpec[] = [];
  for (const e of list.slice(0, MAX_EXPERIMENTS)) {
    if (typeof e !== 'object' || e === null) continue;
    const x = e as Record<string, unknown>;
    const candidates = Array.isArray(x.candidates)
      ? x.candidates
          .filter((c): c is { name: string; script: string } => typeof c === 'object' && c !== null && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { script?: unknown }).script === 'string')
          .slice(0, MAX_CANDIDATES)
          .map((c) => ({ name: c.name.slice(0, 60), script: c.script.slice(0, 20_000) }))
      : [];
    if (typeof x.question !== 'string' || candidates.length < 2) continue;
    const maxMs = Number(x.maxMs);
    out.push({ question: x.question.slice(0, 200), criterion: typeof x.criterion === 'string' ? x.criterion.slice(0, 200) : '종료 0', maxMs: Number.isFinite(maxMs) && maxMs > 0 ? Math.min(maxMs, 60_000) : 10_000, candidates });
  }
  return out;
};

const runOnce = (script: string, env: Record<string, string>, cwd: string, timeoutMs: number): Promise<{ code: number | null; ms: number; out: string; timedOut: boolean }> =>
  new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn('/bin/zsh', [script], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (b: Buffer) => { out = (out + b.toString()).slice(-600); };
    c.stdout.on('data', add);
    c.stderr.on('data', add);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-c.pid!, 'SIGKILL'); } catch { /* 끝남 */ } }, timeoutMs);
    c.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, ms: Date.now() - t0, out: e.message, timedOut }); });
    c.on('close', (code) => { clearTimeout(timer); resolve({ code, ms: Date.now() - t0, out, timedOut }); });
  });

/** 실험 하나를 돌린다. 앱 패키지가 있으면 사본을 $HACKMAC_APP_DIR로 준다 */
export async function runExperiment(spec: ExperimentSpec, o: { pkgDir: string | null; popupStub: string }): Promise<ExperimentResult> {
  const sandbox = mkdtempSync(join(tmpdir(), 'hackmac-exp-'));
  const runs: ExperimentResult['runs'] = [];
  try {
    const home = join(sandbox, 'home');
    mkdirSync(home, { recursive: true });
    mkdirSync(join(sandbox, 'tmp'), { recursive: true });
    for (const cand of spec.candidates) {
      if (/\bosascript\b/.test(cand.script)) {
        runs.push({ name: cand.name, ok: false, ms: 0, note: '실제 앱을 건드리는 후보라 돌리지 않음(사용자 데이터 보호)' });
        continue;
      }
      const file = join(sandbox, `cand-${runs.length}.sh`);
      writeFileSync(file, cand.script);
      const data = join(sandbox, 'data', String(runs.length));
      mkdirSync(data, { recursive: true });
      const env: Record<string, string> = {
        HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'ko_KR.UTF-8', TMPDIR: join(sandbox, 'tmp'),
        HACKMAC_DATA_DIR: data, HACKMAC_POPUP: o.popupStub, HACKMAC_CHECK: '1', ...(o.pkgDir ? { HACKMAC_APP_DIR: o.pkgDir } : {}),
      };
      const times: number[] = [];
      let ok = true;
      let note = '';
      for (let i = 0; i < REPEAT; i++) {
        const r = await runOnce(file, env, data, spec.maxMs * 3);
        times.push(r.ms);
        if (r.timedOut) { ok = false; note = `시간 초과 — 기준 ${spec.maxMs}ms를 넘음`; break; }
        if (r.code !== 0) { ok = false; note = `종료 ${r.code}: ${r.out.trim().split('\n').slice(-1)[0] ?? ''}`; break; }
      }
      const ms = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? 0;
      if (ok && ms > spec.maxMs) { ok = false; note = `${ms}ms — 기준 ${spec.maxMs}ms를 넘음`; }
      runs.push({ name: cand.name, ok, ms, note: ok ? `가운데 ${ms}ms` : note });
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  const winner = runs.filter((r) => r.ok).sort((a, b) => a.ms - b.ms)[0]?.name ?? null;
  return { question: spec.question, criterion: spec.criterion, winner, runs };
}

/** 개발 담당에게 줄 한 줄씩 */
export const experimentLines = (rs: ExperimentResult[]): string[] =>
  rs.map((r) => `${r.question} → ${r.winner ? `"${r.winner}"가 이김` : '합격한 후보 없음(다른 방법을 찾는다)'} (${r.runs.map((x) => `${x.name}: ${x.ok ? '합격' : '불합격'} ${x.note}`).join(' · ')})`);
