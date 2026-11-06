/**
 * 스레드 하나의 제작 진행을 맡는다: 받은편지함의 요청을 처리하고, 진행 기록을 남기고, 평가·검증·설치를 HackMac 코드로 한다.
 *   - 앱 패키지는 <work>/app 한 곳(에이전트가 만든다)
 *   - 진행 기록은 스레드 폴더(작업 폴더 밖)에 둔다 — 에이전트가 기록을 지어낼 수 없게
 *   - submit: 평가가 끝났고 불가능이 아니며, 게이트를 통과해야 설치한다. 설치는 패키지를 복사해 넣는다(작업 폴더는 계속 고칠 수 있다)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatReport, runGate, type GateOptions } from './gate.ts';
import { evaluate, formatVerdict, type EvaluateInput } from './evaluate.ts';
import { BuildInbox, type InboxRequest, type InboxResponse } from './inbox.ts';
import { ProgressLog, STEPS, validateAgentEvent, type BuildState, type SystemEvent } from './progress.ts';

export interface BuilderDeps {
  /**
   * build(기본): 요구사항 → 평가 → 개발 → 검증 → 설치. fix(유지보수 팀, 계획서 11.3): 이미 있는 앱을 고친다 — 요구사항·평가는 건너뛰지만
   * 검증 게이트는 그대로 통과해야 하고(고친 곳을 보이는 시험이 하나는 있어야 한다), "설치"는 호출자가 정한 곳(보관 대기)에 한다.
   */
  mode?: 'build' | 'fix';
  workDir: string;
  progressFile: string;
  gate: Omit<GateOptions, 'requirements' | 'installedVersion'>;
  /** 평가: 프롬프트를 받아 엔진 답 글을 돌려준다. by: 평가한 엔진 이름 */
  evaluator: () => { ask: (prompt: string) => Promise<string>; by: string } | null;
  evaluateContext: Omit<EvaluateInput, 'requirements'>;
  /** 같은 id가 설치돼 있으면 그 선언 버전 */
  installedVersion: (appId: string) => string | null;
  install: (pkgDir: string) => { ok: true; id: string; version: number } | { ok: false; errors: string[] };
  onState: (s: BuildState) => void;
}

export class Builder {
  readonly progress: ProgressLog;
  readonly inbox: BuildInbox;
  readonly pkgDir: string;

  constructor(private readonly d: BuilderDeps) {
    this.progress = new ProgressLog(d.progressFile);
    this.pkgDir = join(d.workDir, 'app');
    this.inbox = new BuildInbox(join(d.workDir, '.hackmac'), (req) => this.handle(req));
  }

  state(): BuildState {
    return this.progress.state();
  }

  private record(e: SystemEvent): void {
    this.progress.append(e);
    this.d.onState(this.state());
  }

  private async handle(req: InboxRequest): Promise<InboxResponse> {
    switch (req.cmd) {
      case 'event': {
        const v = validateAgentEvent(req.args.event);
        if (!v.ok) return { ok: false, text: v.error };
        this.progress.append(v.event);
        this.d.onState(this.state());
        return { ok: true, text: '기록함' };
      }
      case 'status':
        return { ok: true, text: summarize(this.state()) };
      case 'evaluate':
        return this.evaluate();
      case 'verify':
        return this.verify();
      case 'submit':
        return this.submit();
      default:
        return { ok: false, text: `모르는 명령: ${req.cmd}` };
    }
  }

  private async evaluate(): Promise<InboxResponse> {
    const s = this.state();
    const ev = this.d.evaluator();
    if (!ev) return { ok: false, text: '평가에 쓸 엔진이 없음(로그인 확인)' };
    const r = await evaluate({ ...this.d.evaluateContext, requirements: s.requirements.map((x) => ({ id: x.id, text: x.text })) }, ev.ask, ev.by);
    if (!r.ok) return { ok: false, text: r.error };
    this.record({ type: 'verdict', verdict: r.verdict });
    return { ok: true, text: formatVerdict(r.verdict), data: r.verdict };
  }

  private async gate() {
    const s = this.state();
    let installed: string | null = null;
    try {
      const raw = readFileSync(join(this.pkgDir, 'manifest.json'), 'utf8');
      const id = (JSON.parse(raw) as { id?: unknown }).id;
      if (typeof id === 'string') installed = this.d.installedVersion(id);
    } catch {
      // 선언이 없거나 깨졌으면 게이트가 알려 준다
    }
    const report = await runGate(this.pkgDir, { ...this.d.gate, requirements: (this.d.mode === 'fix' ? [] : s.requirements).map((r) => ({ id: r.id, manual: r.manual !== null })), installedVersion: installed });
    this.record({ type: 'gate', ok: report.ok, requirements: report.requirements, summary: formatReport(report) });
    return report;
  }

  private async verify(): Promise<InboxResponse> {
    const report = await this.gate();
    return { ok: report.ok, text: formatReport(report) };
  }

  private async submit(): Promise<InboxResponse> {
    const s = this.state();
    const fix = this.d.mode === 'fix';
    if (!fix && s.requirements.length === 0) return { ok: false, text: '요구사항이 없음 — req로 먼저 기록한다' };
    if (!fix && !s.verdict) return { ok: false, text: '가능성 평가를 먼저 한다(evaluate)' };
    if (!fix && s.verdict?.kind === 'impossible') return { ok: false, text: '평가가 불가능으로 나왔다. 요구사항을 고쳐 다시 evaluate 하거나, 사용자에게 불가능을 알린다' };
    const report = await this.gate();
    if (!report.ok) return { ok: false, text: `설치하지 않음 — 검증을 통과해야 한다\n${formatReport(report)}` };
    const r = this.d.install(this.pkgDir);
    if (!r.ok) return { ok: false, text: `설치하지 못함: ${r.errors.join('; ')}` };
    this.record({ type: 'installed', appId: r.id, version: r.version });
    if (fix) return { ok: true, text: `수정본을 검증했고 보관했다(${r.id}). 사용자가 확인하면 적용된다. 여기서 끝낸다 — 더 하지 말고 무엇을 고쳤는지 두세 문장으로 답한다.`, data: r };
    const manual = s.requirements.filter((x) => x.manual);
    return {
      ok: true,
      text: [`설치함: ${r.id}. 사용자의 HackMac "내 앱"에 나타났다. 켜는 것은 사용자가 한다.`, ...(manual.length ? ['자동으로 시험하지 못한 요구사항 — 사용자에게 직접 해 보고 알려 달라고 부탁한다:', ...manual.map((x) => `  - ${x.id} ${x.text} (${x.manual})`)] : [])].join('\n'),
      data: r,
    };
  }

  start(): void {
    this.inbox.start();
  }

  stop(): void {
    this.inbox.stop();
  }
}

export const summarize = (s: BuildState): string => [
  `단계 ${s.step} ${STEPS[s.step - 1]}${s.now ? ` — 지금: ${s.now}` : ''}`,
  ...(s.requirements.length ? s.requirements.map((r) => `${r.id} [${r.status}] ${r.text}${r.manual ? ` (수동: ${r.manual})` : ''}`) : ['요구사항 없음']),
  s.verdict ? `평가: ${s.verdict.kind} — ${s.verdict.summary}` : '평가: 아직',
  s.gate ? `마지막 검증: ${s.gate.ok ? '통과' : '실패'}` : '검증: 아직',
  ...(s.ask ? [`확인 필요: ${s.ask}`] : []),
  ...(s.installed ? [`설치됨: ${s.installed.appId}`] : []),
].join('\n');
