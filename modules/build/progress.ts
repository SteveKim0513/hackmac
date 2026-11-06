/**
 * 제작 진행 기록(계획서 8.1). 진행 상태는 에이전트의 글에서 추측하지 않는다 —
 * 에이전트가 `$HACKMAC_BUILD` 명령으로 보낸 사건과, HackMac이 직접 낸 사건(평가·검증·설치)만 기록하고 화면은 그것만 그린다.
 * 기록: <스레드 work>/.hackmac/progress.jsonl, 추가만. 상태는 기록을 처음부터 다시 접어서 만든다(reduce).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AuditItem } from './audit.ts';
import type { RoleId } from './roles.ts';

export const STEPS = ['요구 정리', '가능성 평가', '개발', '자체 검증', '사용자 확인', '완료'] as const;
export type FailureType = 'macos' | 'capability' | 'external' | 'unknown';
export const FAILURE_LABEL: Record<FailureType, string> = {
  macos: 'macOS가 막음',
  capability: 'HackMac에 아직 그 능력이 없음',
  external: '외부 조건이 필요함',
  unknown: '원인을 못 찾음',
};

/** 에이전트가 보낼 수 있는 사건 */
export type AgentEvent =
  | { type: 'step'; step: number; now?: string }
  | { type: 'now'; text: string }
  /** accept: 사용자에게서 캐낸 합격 기준(이렇게 되면 된 것이다). 요구 정리 담당이 질문으로 뽑아 글로 고정한다 */
  | { type: 'req'; id: string; text: string; manual?: string; accept?: string[] }
  | { type: 'req-remove'; id: string }
  | { type: 'ask'; text: string }
  | { type: 'ask-done' }
  /** 계획서 7.4 실패 기록 형식. 근거가 2개 미만이면 기록만 하고 판정으로 세지 않는다 */
  | { type: 'fail'; failure: FailureType; needed: string; evidence: string[] };

export interface Verdict { kind: 'possible' | 'conditional' | 'impossible'; summary: string; conditions: string[]; reasons: string[]; by: string }

/** 채점표 한 줄: 개발 전에 다른 역할이 쓴 합격 기준. auto면 시험으로, manual이면 사용자가 확인한다 */
export interface RubricItem { id: string; req: string; criterion: string; how: 'auto' | 'manual' }
/** 후보 실험 결과(설계가 낸 후보를 격리된 곳에서 돌려 잰 것) */
export interface ExperimentResult { question: string; criterion: string; winner: string | null; runs: { name: string; ok: boolean; ms: number; note: string }[] }

/** HackMac이 직접 내는 사건 */
export type SystemEvent =
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'rubric'; items: RubricItem[]; by: string }
  | { type: 'experiment'; result: ExperimentResult }
  /** 전문 담당 하나가 일을 시작했다(round 0 = 처음, 1~ = 보완) */
  | { type: 'role'; role: RoleId; label: string; round: number }
  | { type: 'pipeline'; status: 'start' | 'fail' | 'done' | 'cancel'; reason?: string }
  | { type: 'audit'; ok: boolean; by: string; items: AuditItem[] }
  /** 설치된 앱을 고치기 시작했다(앱 상세의 [수정하기]). 진행을 처음부터 다시 하되 요구사항은 그대로 둔다 */
  | { type: 'edit-start'; appId: string; version: number }
  | { type: 'gate'; ok: boolean; requirements: Record<string, string>; summary: string }
  | { type: 'installed'; appId: string; version: number };

export type BuildEvent = (AgentEvent | SystemEvent) & { at?: string };

export type ReqStatus = 'todo' | 'passed' | 'failed' | 'missing' | 'manual';
export interface BuildState {
  step: number;
  now: string | null;
  requirements: { id: string; text: string; manual: string | null; accept: string[]; status: ReqStatus }[];
  ask: string | null;
  verdict: Verdict | null;
  failures: { failure: FailureType; needed: string; evidence: string[]; counted: boolean; at: string | null }[];
  gate: { ok: boolean; summary: string; at: string | null } | null;
  installed: { appId: string; version: number } | null;
  rubric: { items: RubricItem[]; by: string } | null;
  experiments: ExperimentResult[];
  /** 지금 일하는 전문 담당 */
  role: { id: RoleId; label: string; round: number } | null;
  pipeline: { status: 'running' | 'failed' | 'done' | 'cancelled'; reason: string | null } | null;
  audit: { ok: boolean; by: string; items: AuditItem[]; at: string | null } | null;
  /** 고치는 중인 설치된 앱 */
  edit: { appId: string; version: number } | null;
  /** 자세한 기록(접어서 보인다) */
  log: { at: string | null; text: string }[];
}

export const EMPTY_STATE: BuildState = {
  step: 1, now: null, requirements: [], ask: null, verdict: null, failures: [], gate: null, installed: null,
  rubric: null, experiments: [], role: null, pipeline: null, audit: null, edit: null, log: [],
};

const REQ_ID = /^R[1-9][0-9]{0,2}$/;
const str = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** 에이전트가 보낸 사건을 따져 읽는다(신뢰 경계). 틀리면 에이전트에게 돌려줄 이유 */
export const validateAgentEvent = (raw: unknown): { ok: true; event: AgentEvent } | { ok: false; error: string } => {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '사건이 객체가 아님' };
  const o = raw as Record<string, unknown>;
  switch (o.type) {
    case 'step': {
      const step = Number(o.step);
      if (!Number.isInteger(step) || step < 1 || step > STEPS.length) return { ok: false, error: `단계는 1~${STEPS.length}` };
      if (step === 6) return { ok: false, error: '완료(6)는 submit이 검증을 통과해야 HackMac이 정한다' };
      const now = str(o.now, 200);
      return { ok: true, event: { type: 'step', step, ...(now ? { now } : {}) } };
    }
    case 'now': {
      const text = str(o.text, 200);
      return text ? { ok: true, event: { type: 'now', text } } : { ok: false, error: '지금 하는 일을 한 줄로' };
    }
    case 'req': {
      const id = str(o.id, 5);
      const text = str(o.text, 300);
      if (!id || !REQ_ID.test(id)) return { ok: false, error: '요구사항 번호는 R1, R2 … 형식' };
      if (!text) return { ok: false, error: '요구사항 내용이 비었음' };
      const manual = o.manual === undefined ? null : str(o.manual, 300);
      if (o.manual !== undefined && !manual) return { ok: false, error: '--manual에는 자동으로 시험할 수 없는 이유를 적는다' };
      const accept = Array.isArray(o.accept) ? o.accept.map((a) => str(a, 300)).filter((a): a is string => a !== null).slice(0, 8) : [];
      return { ok: true, event: { type: 'req', id, text, ...(manual ? { manual } : {}), ...(accept.length ? { accept } : {}) } };
    }
    case 'req-remove': {
      const id = str(o.id, 5);
      return id && REQ_ID.test(id) ? { ok: true, event: { type: 'req-remove', id } } : { ok: false, error: '요구사항 번호는 R1, R2 … 형식' };
    }
    case 'ask': {
      const text = str(o.text, 300);
      return text ? { ok: true, event: { type: 'ask', text } } : { ok: false, error: '사용자에게 부탁할 일을 적는다' };
    }
    case 'ask-done':
      return { ok: true, event: { type: 'ask-done' } };
    case 'fail': {
      if (!['macos', 'capability', 'external', 'unknown'].includes(String(o.failure))) return { ok: false, error: '--type은 macos|capability|external|unknown' };
      const needed = str(o.needed, 300);
      const evidence = Array.isArray(o.evidence) ? o.evidence.map((e) => str(e, 500)).filter((e): e is string => e !== null) : [];
      if (!needed) return { ok: false, error: '--needed: 어떤 능력·조건이 있었으면 됐나 한 줄' };
      return { ok: true, event: { type: 'fail', failure: o.failure as FailureType, needed, evidence } };
    }
    default:
      return { ok: false, error: `모르는 사건: ${String(o.type)}` };
  }
};

export const reduce = (events: BuildEvent[]): BuildState => {
  const s: BuildState = structuredClone(EMPTY_STATE);
  const log = (e: BuildEvent, text: string) => s.log.push({ at: e.at ?? null, text });
  for (const e of events) {
    switch (e.type) {
      case 'step':
        s.step = e.step;
        if (e.now) s.now = e.now;
        log(e, `단계 ${e.step} ${STEPS[e.step - 1]}${e.now ? ` — ${e.now}` : ''}`);
        break;
      case 'now':
        s.now = e.text;
        log(e, e.text);
        break;
      case 'req': {
        const existing = s.requirements.find((r) => r.id === e.id);
        const next = { id: e.id, text: e.text, manual: e.manual ?? null, accept: e.accept ?? [], status: (e.manual ? 'manual' : 'todo') as ReqStatus };
        if (existing) Object.assign(existing, next);
        else s.requirements.push(next);
        s.requirements.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
        break;
      }
      case 'req-remove':
        s.requirements = s.requirements.filter((r) => r.id !== e.id);
        break;
      case 'ask':
        s.ask = e.text;
        log(e, `확인 필요: ${e.text}`);
        break;
      case 'ask-done':
        s.ask = null;
        break;
      case 'fail':
        s.failures.push({ failure: e.failure, needed: e.needed, evidence: e.evidence, counted: e.evidence.length >= 2, at: e.at ?? null });
        log(e, `실패 기록: ${FAILURE_LABEL[e.failure]} — ${e.needed}`);
        break;
      case 'verdict':
        s.verdict = e.verdict;
        log(e, `가능성 평가: ${e.verdict.kind} — ${e.verdict.summary}`);
        break;
      case 'gate':
        s.gate = { ok: e.ok, summary: e.summary, at: e.at ?? null };
        for (const r of s.requirements) {
          const st = e.requirements[r.id];
          if (st === 'passed' || st === 'failed' || st === 'missing' || st === 'manual') r.status = st;
        }
        log(e, e.summary.split('\n')[0]);
        break;
      case 'rubric':
        s.rubric = { items: e.items, by: e.by };
        log(e, `채점표: ${e.items.length}개 기준(${e.by})`);
        break;
      case 'experiment':
        s.experiments.push(e.result);
        log(e, `실험: ${e.result.question} → ${e.result.winner ?? '통과한 후보 없음'}`);
        break;
      case 'role':
        s.role = { id: e.role, label: e.label, round: e.round };
        log(e, `${e.label}${e.round ? ` (${e.round}번째 보완)` : ''}`);
        break;
      case 'pipeline':
        s.pipeline = { status: e.status === 'start' ? 'running' : e.status === 'fail' ? 'failed' : e.status === 'cancel' ? 'cancelled' : 'done', reason: e.reason ?? null };
        if (e.status !== 'start') s.role = null;
        log(e, e.status === 'start' ? '전문 담당들에게 넘김' : e.status === 'done' ? '제작 끝' : e.status === 'cancel' ? '제작을 멈춤' : `제작 실패: ${e.reason ?? ''}`);
        break;
      case 'audit':
        s.audit = { ok: e.ok, by: e.by, items: e.items, at: e.at ?? null };
        log(e, `목표 확인: ${e.items.filter((x) => x.met).length}/${e.items.length} 충족(${e.by})`);
        break;
      case 'edit-start':
        Object.assign(s, { step: 1, now: null, ask: null, verdict: null, gate: null, installed: null, rubric: null, experiments: [], role: null, pipeline: null, audit: null });
        s.edit = { appId: e.appId, version: e.version };
        for (const r of s.requirements) r.status = r.manual ? 'manual' : 'todo';
        log(e, `수정 시작: ${e.appId} (지금 ${e.version}번째 버전)`);
        break;
      case 'installed':
        s.installed = { appId: e.appId, version: e.version };
        s.edit = null;
        s.step = 6;
        s.ask = null;
        s.now = null;
        log(e, `설치됨: ${e.appId} (이 맥의 ${e.version}번째 버전)`);
        break;
    }
  }
  if (s.log.length > 200) s.log = s.log.slice(-200);
  return s;
};

export class ProgressLog {
  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {}

  append(e: AgentEvent | SystemEvent): BuildEvent {
    mkdirSync(dirname(this.file), { recursive: true });
    const full: BuildEvent = { ...e, at: this.now().toISOString() };
    appendFileSync(this.file, JSON.stringify(full) + '\n');
    return full;
  }

  events(): BuildEvent[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').flatMap((l) => {
      if (!l.trim()) return [];
      try { return [JSON.parse(l) as BuildEvent]; } catch { return []; }
    });
  }

  state(): BuildState {
    return reduce(this.events());
  }
}
