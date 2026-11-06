/**
 * 제작 파이프라인: 요구 정리 담당이 `handoff`하면 HackMac 코드가 전문 담당들을 차례로 부른다. 순서와 판정은 코드가 쥔다 —
 * 어느 담당도 "다 됐다"로 다음 단계를 열 수 없고, 넘어가는 문은 코드의 검사(채점표 모양·설계 파일·검증 게이트·감사 판정)뿐이다.
 *
 *   채점(examiner) → 설계(designer) → 후보 실험(코드) → 개발(developer) → 카피(copywriter) → 시험(tester)
 *   → [검증 게이트(코드) → 감사(auditor)] → 어긋나면 개발·시험 보완 → 다시 검증 … 최대 maxRounds번 → 설치
 *
 * 지키는 것:
 *   - 담당끼리는 파일로만 넘긴다(spec/design.md, spec/experiments.json, app/, app/checks/).
 *   - 카피 담당은 카피 칸만, 시험 담당은 checks/만 바꾼다. 다른 곳을 바꾸면 코드가 되돌린다(만든 쪽이 시험을, 시험 쪽이 코드를 맞추지 못하게).
 *   - 보완 끝에 통과하면 "무엇에 걸렸고 어떻게 고쳤나"를 배운 것(modules/knowledge)으로 남겨 다음 제작이 이어받는다.
 * 엔진 호출(runRole)은 주입받는다 — 시험은 가짜 담당으로, 실제로는 electron/studioHost.ts가 역할별 엔진을 붙인다.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseManifest } from '../../shared/manifest.ts';
import { BASELINE_AUDIT, collectFiles, parseAudit, type AuditResult } from './audit.ts';
import { experimentLines, readExperiments, runExperiment } from './experiment.ts';
import type { GateReport } from './gate.ts';
import type { AgentEvent, BuildState, ExperimentResult, RubricItem, SystemEvent } from './progress.ts';
import { auditorPrompt, auditProblems, copywriterPrompt, designerPrompt, developerPrompt, examinerPrompt, rubricLines, ROLES, testerPrompt, type Req, type RoleId } from './roles.ts';
import { parseRubric } from './rubric.ts';

export interface PipelineDeps {
  workDir: string;
  state: () => BuildState;
  record: (e: SystemEvent | AgentEvent) => void;
  /** 그 담당에게 일을 시키고 답 글을 받는다. 지시문·엔진·도구는 호출자가 역할에 맞게 붙인다 */
  runRole: (role: RoleId, prompt: string, signal: AbortSignal) => Promise<string>;
  /** 그 담당을 맡은 엔진 이름(채점표·감사 기록에 남긴다) */
  roleBy: (role: RoleId) => string;
  gate: () => Promise<GateReport>;
  install: () => { ok: true; id: string; version: number } | { ok: false; errors: string[] };
  lessons: () => string[];
  learn: (text: string) => void;
  popupStub: string;
  maxRounds?: number;
}

export type PipelineOutcome =
  | { ok: true; appId: string; version: number; audit: AuditResult; manual: RubricItem[]; rounds: number }
  | { ok: false; stage: string; reason: string; cancelled: boolean };

class Cancelled extends Error {}

const COPY_FIELDS = ['tagline', 'usage', 'whatItIs', 'differentiators', 'strengths'];

/** 폴더의 파일 내용 사진(시험 담당·카피 담당이 건드리면 안 되는 곳을 지킨다) */
const snapshot = (root: string, rels: string[]): Map<string, Buffer> => {
  const out = new Map<string, Buffer>();
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p), readFileSync(p));
    }
  };
  for (const r of rels) {
    const p = join(root, r);
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else out.set(r, readFileSync(p));
  }
  return out;
};
const sameSnap = (a: Map<string, Buffer>, b: Map<string, Buffer>) => a.size === b.size && [...a].every(([k, v]) => b.get(k)?.equals(v));
const restoreSnap = (root: string, rels: string[], snap: Map<string, Buffer>) => {
  for (const r of rels) {
    const p = join(root, r);
    if (existsSync(p) && statSync(p).isDirectory()) rmSync(p, { recursive: true, force: true });
  }
  for (const [rel, buf] of snap) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), buf);
  }
};

export async function runPipeline(d: PipelineDeps, signal: AbortSignal): Promise<PipelineOutcome> {
  const pkg = join(d.workDir, 'app');
  const spec = join(d.workDir, 'spec');
  const maxRounds = d.maxRounds ?? 3;
  let stage = '시작';
  const check = () => { if (signal.aborted) throw new Cancelled(); };
  const now = (text: string) => d.record({ type: 'now', text });
  const role = async (id: RoleId, prompt: string, round = 0): Promise<string> => {
    check();
    d.record({ type: 'role', role: id, label: ROLES[id].label, round });
    now(ROLES[id].doing + (round ? ` (${round}번째 보완)` : ''));
    const text = await d.runRole(id, prompt, signal);
    check();
    return text;
  };

  try {
    d.record({ type: 'pipeline', status: 'start' });
    const st = d.state();
    const reqs: Req[] = st.requirements.map((r) => ({ id: r.id, text: r.text, manual: r.manual, accept: r.accept }));
    const existing = st.edit !== null;
    const lessons = d.lessons();
    mkdirSync(spec, { recursive: true });
    d.record({ type: 'step', step: 3, now: '전문 담당들이 만드는 중' });

    // 1. 채점표: 일하기 전에 합격 기준부터. 못 읽으면 이유를 붙여 한 번 더
    stage = '채점표';
    let rub = parseRubric(await role('examiner', examinerPrompt({ requirements: reqs, baseline: BASELINE_AUDIT })), reqs.map((r) => r.id));
    if (!rub.ok) rub = parseRubric(await role('examiner', `${examinerPrompt({ requirements: reqs, baseline: BASELINE_AUDIT })}\n\n앞선 답이 틀렸다: ${rub.error}. 모양을 지켜 다시 쓴다.`), reqs.map((r) => r.id));
    if (!rub.ok) return fail(stage, `채점표를 만들지 못했어요(${rub.error})`);
    const rubric = rub.items;
    d.record({ type: 'rubric', items: rubric, by: d.roleBy('examiner') });
    const rl = rubricLines(rubric);

    // 2. 설계: 파일이 있고 요구사항을 다 다뤄야 한다
    stage = '설계';
    const designFile = join(spec, 'design.md');
    await role('designer', designerPrompt({ requirements: reqs, conditions: st.verdict?.conditions ?? [], existing, rubric: rl, lessons }));
    const missingIn = () => {
      const t = existsSync(designFile) ? readFileSync(designFile, 'utf8') : '';
      return t.trim().length < 40 ? reqs.map((r) => r.id) : reqs.filter((r) => !new RegExp(`\\b${r.id}\\b`).test(t)).map((r) => r.id);
    };
    if (missingIn().length) await role('designer', `${designerPrompt({ requirements: reqs, conditions: st.verdict?.conditions ?? [], existing, rubric: rl, lessons })}\n\n./spec/design.md에 다음 요구사항이 빠졌다: ${missingIn().join(', ')}. 채워 넣는다.`);
    if (!existsSync(designFile)) return fail(stage, '설계 문서가 만들어지지 않았어요');

    // 3. 후보 실험: 설계가 적어 둔 것만, 격리된 곳에서 잰다
    stage = '실험';
    const experiments: ExperimentResult[] = [];
    for (const x of readExperiments(join(spec, 'experiments.json'))) {
      check();
      now(`후보 ${x.candidates.length}개를 실제로 돌려 재는 중: ${x.question}`);
      const r = await runExperiment(x, { pkgDir: existsSync(pkg) ? pkg : null, popupStub: d.popupStub });
      experiments.push(r);
      d.record({ type: 'experiment', result: r });
    }

    // 4. 개발
    stage = '개발';
    await role('developer', developerPrompt({ requirements: reqs, round: 0, problems: [], existing, rubric: rl, lessons, experiments: experimentLines(experiments) }));
    if (!existsSync(join(pkg, 'manifest.json'))) return fail(stage, '앱 선언(manifest.json)이 만들어지지 않았어요');

    // 5. 카피: 카피 칸만 바뀌어야 한다
    stage = '카피';
    await guardedCopy();

    // 6. 시험: checks/만 바뀌어야 한다
    stage = '시험';
    await guardedTester(0, []);

    // 7. 검증 → 감사 → 보완
    let fixedProblems: string[] = [];
    for (let round = 0; ; round++) {
      stage = '검증';
      check();
      d.record({ type: 'step', step: 4, now: '검증 게이트와 감사 담당이 확인하는 중' });
      const report = await d.gate();
      let problems: string[];
      let audit: AuditResult | null = null;
      if (!report.ok) {
        problems = report.checks.filter((c) => !c.ok).flatMap((c) => c.problems.map((p) => `[검증 ${c.label}] ${p}`));
      } else {
        stage = '감사';
        audit = await runAudit(rl);
        problems = audit.ok ? [] : auditProblems(audit.items);
      }
      if (audit?.ok) {
        // 통과: 보완으로 고친 것을 배운 것으로 남긴다(다음 제작이 같은 데서 걸리지 않게)
        for (const p of fixedProblems.slice(0, 3)) d.learn(`제작 중 걸렸다가 고친 것: ${p.replace(/^\[[^\]]+\]\s*/, '')}`);
        stage = '설치';
        const r = d.install();
        if (!r.ok) return fail(stage, `설치하지 못했어요: ${r.errors.join('; ')}`);
        d.record({ type: 'pipeline', status: 'done' });
        return { ok: true, appId: r.id, version: r.version, audit, manual: rubric.filter((x) => x.how === 'manual'), rounds: round };
      }
      if (round >= maxRounds) {
        const reason = `${maxRounds}번 보완해도 다음이 남았어요: ${problems.slice(0, 3).join(' / ')}`;
        for (const p of problems.slice(0, 2)) d.learn(`끝내 못 푼 것(다른 방법을 먼저 찾는다): ${p.replace(/^\[[^\]]+\]\s*/, '')}`);
        return fail(stage, reason);
      }
      fixedProblems = problems;
      d.record({ type: 'step', step: 3, now: '찾은 문제를 고치는 중' });
      stage = '보완';
      await role('developer', developerPrompt({ requirements: reqs, round: round + 1, problems, existing, rubric: rl, lessons, experiments: [] }), round + 1);
      await guardedTester(round + 1, problems);
    }
  } catch (err) {
    if (err instanceof Cancelled || signal.aborted) {
      d.record({ type: 'pipeline', status: 'cancel' });
      return { ok: false, stage, reason: '제작을 멈췄어요', cancelled: true };
    }
    return fail(stage, `${stage} 중에 문제가 생겼어요: ${(err as Error).message}`);
  }

  function fail(at: string, reason: string): PipelineOutcome {
    d.record({ type: 'pipeline', status: 'fail', reason });
    return { ok: false, stage: at, reason, cancelled: false };
  }

  async function guardedCopy(): Promise<void> {
    const mf = join(pkg, 'manifest.json');
    const before = readFileSync(mf, 'utf8');
    await role('copywriter', copywriterPrompt());
    let ok = false;
    try {
      const a = JSON.parse(before) as Record<string, unknown>;
      const b = JSON.parse(readFileSync(mf, 'utf8')) as Record<string, unknown>;
      const strip = (o: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !COPY_FIELDS.includes(k)).sort(([x], [y]) => x.localeCompare(y))));
      ok = strip(a) === strip(b) && parseManifest(b).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      writeFileSync(mf, before);
      now('카피 담당이 카피 말고 다른 칸을 바꿔서 되돌렸어요');
    }
  }

  async function guardedTester(round: number, problems: string[]): Promise<void> {
    const guarded = ['manifest.json', 'scripts'];
    const snap = snapshot(pkg, guarded);
    await role('tester', testerPrompt({ requirements: d.state().requirements.map((r) => ({ id: r.id, text: r.text, manual: r.manual, accept: r.accept })), round, problems, rubric: rubricLines(d.state().rubric?.items ?? []), lessons: d.lessons() }), round);
    if (!sameSnap(snap, snapshot(pkg, guarded))) {
      restoreSnap(pkg, guarded, snap);
      now('시험 담당이 앱 코드를 바꿔서 되돌렸어요(시험은 코드를 맞추지 않는다)');
    }
  }

  async function runAudit(rl: string[]): Promise<AuditResult> {
    const reqs = d.state().requirements;
    const { files, truncated } = collectFiles(pkg);
    const prompt = auditorPrompt({ requirements: reqs.map((r) => ({ id: r.id, text: r.text, manual: r.manual, accept: r.accept })), rubric: rl, baseline: BASELINE_AUDIT.map((b) => ({ id: b.id, text: `${b.label}: ${b.text}` })), files, truncated });
    let res = parseAudit(await role('auditor', prompt), reqs, d.roleBy('auditor'));
    if (!res) res = parseAudit(await role('auditor', `${prompt}\n\n앞선 답을 읽지 못했다. JSON 모양을 지켜 다시 낸다.`), reqs, d.roleBy('auditor'));
    // 판정을 못 읽으면 통과로 치지 않는다: 모든 항목 미충족
    const result: AuditResult = res ?? {
      ok: false,
      by: d.roleBy('auditor'),
      items: [
        ...reqs.map((r) => ({ id: r.id, kind: 'goal' as const, label: r.text, met: false, evidence: '', gap: '감사 답을 읽지 못함' })),
        ...BASELINE_AUDIT.map((b) => ({ id: b.id, kind: 'baseline' as const, label: b.label, met: false, evidence: '', gap: '감사 답을 읽지 못함' })),
      ],
    };
    d.record({ type: 'audit', ok: result.ok, by: result.by, items: result.items });
    return result;
  }
}

/** 요구 정리 담당에게 돌려줄 결과 글(사용자에게 말할 재료). 확인한 것과 못 한 것을 나눠 쓴다 */
export const outcomeText = (o: PipelineOutcome): string => {
  if (!o.ok) {
    return o.cancelled
      ? '[HackMac 제작 결과] 제작을 멈췄다. 사용자에게 멈췄다고 짧게 알리고, 바뀐 요구가 있으면 req로 고친 뒤 다시 handoff 한다.'
      : [
          `[HackMac 제작 결과] 실패(${o.stage}): ${o.reason}`,
          '사용자에게: 결론 한 줄 → 쉬운 이유 → 대신 할 수 있는 것(요구를 줄이기, 다른 방법) 순서로 알린다. 요구를 바꾸기로 하면 req로 고치고 다시 handoff 한다.',
        ].join('\n');
  }
  const goals = o.audit.items.filter((x) => x.kind === 'goal');
  return [
    `[HackMac 제작 결과] 설치함: ${o.appId}(이 맥의 ${o.version}번째 버전).${o.rounds ? ` 검증·감사에서 걸린 것을 ${o.rounds}번 보완했다.` : ''}`,
    '확인한 것(다른 역할의 감사가 코드에서 근거를 찾음):',
    ...goals.map((g) => `  - ${g.id} ${g.label}: ${g.evidence}`),
    ...(o.manual.length
      ? ['자동으로 확인하지 못한 것(사람이 봐야 함) — 사용자에게 직접 해 보고 알려 달라고 부탁하고 ask로 기록한다:', ...o.manual.map((m) => `  - ${m.id} ${m.criterion}`)]
      : ['자동으로 확인하지 못한 것: 없음(그래도 실제 단축키·알림은 이 맥에서 처음 눌러 봐야 안다).']),
    '사용자에게: 무엇이 되었는지 → 켜는 법(홈의 내 앱 → 카드) → 처음 실행 때 뜰 권한 창 → 직접 확인할 것 순서로 짧게 말한다. 확인 못 한 것을 확인했다고 말하지 않는다.',
  ].join('\n');
};
