/**
 * 자가 유지보수 감시자(계획서 11). 실행 서버 안에서 실행기 사건을 듣고:
 *   1. 실패를 코드가 먼저 분류한다(classify.ts).
 *   2. 외부 원인(권한·인터넷·상대 서비스)은 에이전트를 부르지 않고 안내만 한다.
 *   3. 코드 원인은 되풀이될 때 유지보수 팀을 부른다. 팀은 격리 폴더에서 수정본을 만들고 검증 게이트를 통과해야만 "보관 대기"에 올린다.
 *   4. 수정본은 자동으로 적용하지 않는다: 사용자가 [적용]을 눌러야 새 버전이 된다(설정에서 자동 적용을 켤 수 있고, 켜도 알린다).
 *   5. 한도 보호: 같은 앱 하루 3번, 조용한 시간(밤)·사용자가 개발 중일 때는 미룬다.
 * 모든 판단은 원장에 남긴다(maintain.*). 화면(팝업)·팀(엔진)·스레드 기록은 주입받아 Electron 없이 시험한다.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ledger, LedgerEvent } from '../ledger/ledger.ts';
import type { RunnerEvent } from '../runner/runner.ts';
import { classify, type Advice, type Cause, type Diagnosis } from './classify.ts';
import { DEFAULT_POLICY, isQuiet, teamDecision, type PolicyConfig } from './policy.ts';

export interface Incident {
  fixId: string;
  appId: string;
  appName: string;
  diag: Diagnosis;
  /** 실패한 실행의 로그(끝부분) */
  log: string;
  /** 이 실패가 하루 안에 몇 번 되풀이됐나 */
  occurrences: number;
  at: string;
}

export type TeamResult = { ok: true; summary: string } | { ok: false; reason: string };

export interface PendingFix {
  id: string;
  appId: string;
  appName: string;
  cause: Cause;
  /** 무슨 일이었나(쉬운 말 한 줄) */
  problem: string;
  /** 고친 것(팀의 요약) */
  summary: string;
  createdAt: string;
  announced: boolean;
  /** 고친 패키지 폴더 */
  dir: string;
}

export interface MaintainUi {
  advise(appId: string, appName: string, advice: Advice): void;
  offerFix(fix: PendingFix): void;
  notifyApplied(fix: PendingFix, version: number): void;
  notifyUnfixed(appId: string, appName: string, reason: string): void;
}

export interface MaintainDeps {
  ledger: Ledger;
  now?: () => Date;
  /** 수정본을 두는 곳. <root>/<fixId>/{meta.json, app/} */
  pendingRoot: string;
  /** 이 앱을 알고 켜져 있는가. 모르거나 꺼진 앱의 실패는 무시한다 */
  app: (appId: string) => { name: string; enabled: boolean } | null;
  /** 그 실행의 로그(끝부분). logPath가 없으면 그 앱의 가장 최근 로그 */
  readLog: (appId: string, logPath: string | null) => string;
  /** 팀에게 맡긴다. 수정한 패키지는 stageDir(= <pendingRoot>/<fixId>/app)에 둔다 */
  team: (incident: Incident, stageDir: string) => Promise<TeamResult>;
  applyFix: (pkgDir: string, appId: string) => Promise<{ ok: true; version: number } | { ok: false; error: string }>;
  userBusy: () => boolean;
  autoApply: () => boolean;
  ui: MaintainUi;
  /** 그 앱의 스레드에 알림 글을 남긴다(스레드가 없으면 아무것도 안 한다) */
  threadNotice: (appId: string, text: string) => void;
  policy?: Partial<PolicyConfig>;
}

const dateWord = (d: Date): string => `${d.getMonth() + 1}월 ${d.getDate()}일`;
const HOUR = 3_600_000;

export class Maintainer {
  private readonly cfg: PolicyConfig;
  private readonly now: () => Date;
  private readonly queue = new Map<string, Incident>();
  private readonly inFlight = new Set<string>();
  /** 조용한 시간에 모아 둔, 아침에 보여 줄 것들 */
  private readonly deferred: (() => void)[] = [];
  private stopped = false;

  constructor(private readonly d: MaintainDeps) {
    this.cfg = { ...DEFAULT_POLICY, ...d.policy };
    this.now = d.now ?? (() => new Date());
    mkdirSync(d.pendingRoot, { recursive: true });
  }

  stop(): void {
    this.stopped = true;
  }

  /** 실행기 사건 하나. 실패만 본다 */
  handle(e: RunnerEvent): void {
    if (this.stopped) return;
    let logPath: string | null = null;
    let force = false;
    let code: number | null = null;
    let signal: string | null = null;
    if (e.kind === 'run.end') {
      if (e.stopped || (e.code === 0 && e.signal === null)) return;
      logPath = e.logPath;
      code = e.code;
      signal = e.signal;
    } else if (e.kind === 'resident.gaveup') {
      // 상주 앱이 계속 죽어 실행기가 포기했다. 한 번 더 기다릴 이유가 없다
      force = true;
      code = 1;
    } else return;
    const app = this.d.app(e.appId);
    if (!app || !app.enabled) return;

    const log = this.d.readLog(e.appId, logPath);
    const diag = classify({ code, signal, log, appName: app.name });
    if (!diag) return;
    this.d.ledger.append({ kind: 'maintain.failure', appId: e.appId, cause: diag.cause, signature: diag.signature, summary: diag.summary });

    if (diag.cause === 'permission' || diag.cause === 'network' || diag.cause === 'external') {
      this.advise(e.appId, app.name, diag);
      return;
    }
    // 코드 원인(또는 모르는 원인): 이미 고치는 중이거나 고친 것이 대기 중이면 또 부르지 않는다
    if (this.inFlight.has(e.appId) || this.pending(e.appId).length > 0) return;
    const occurrences = this.occurrences(e.appId, diag.signature);
    if (!force && occurrences < this.cfg.failuresToCall) {
      this.d.ledger.append({ kind: 'maintain.watching', appId: e.appId, signature: diag.signature, occurrences });
      return;
    }
    this.queue.set(e.appId, { fixId: randomUUID(), appId: e.appId, appName: app.name, diag, log, occurrences, at: this.now().toISOString() });
    this.pump();
  }

  private since(hours: number): number {
    return this.now().getTime() - hours * HOUR;
  }

  private recent(kind: string, appId: string): LedgerEvent[] {
    return this.d.ledger.read({ days: 2, appId, kind }).filter((x) => new Date(x.at).getTime() >= this.since(24));
  }

  private occurrences(appId: string, signature: string): number {
    return this.recent('maintain.failure', appId).filter((x) => x.signature === signature).length;
  }

  /** 조용한 시간이면 아침으로 미룬다 */
  private whenAwake(fn: () => void): void {
    if (isQuiet(this.now(), this.cfg)) this.deferred.push(fn);
    else fn();
  }

  private advise(appId: string, appName: string, diag: Diagnosis): void {
    if (!diag.advice) return;
    const advice = diag.advice;
    const last = this.d.ledger.read({ days: 2, appId, kind: 'maintain.advice' }).filter((x) => x.cause === diag.cause).at(-1);
    if (last && new Date(last.at).getTime() > this.now().getTime() - this.cfg.adviceCooldownMs) return;
    this.d.ledger.append({ kind: 'maintain.advice', appId, cause: diag.cause });
    this.whenAwake(() => this.d.ui.advise(appId, appName, advice));
  }

  private pump(): void {
    for (const [appId, inc] of [...this.queue]) {
      if (this.inFlight.has(appId)) continue;
      if (this.pending(appId).length > 0) { this.queue.delete(appId); continue; }
      const failedAt = this.d.ledger.read({ days: 1, appId, kind: 'maintain.failed' }).at(-1)?.at;
      if (failedAt && new Date(failedAt).getTime() > this.now().getTime() - this.cfg.retryAfterFailMs) {
        this.queue.delete(appId);
        this.d.ledger.append({ kind: 'maintain.skipped', appId, reason: 'cooldown' });
        continue;
      }
      const calls = this.recent('maintain.call', appId).length;
      const decision = teamDecision({ now: this.now(), calledLast24h: calls, userBusy: this.d.userBusy() }, this.cfg);
      if (decision === 'cap') {
        this.queue.delete(appId);
        this.d.ledger.append({ kind: 'maintain.skipped', appId, reason: 'cap', calls });
      } else if (decision === 'go') {
        this.queue.delete(appId);
        this.inFlight.add(appId);
        void this.run(inc);
      }
      // quiet·busy: 큐에 둔다. tick이 다시 본다
    }
  }

  private async run(inc: Incident): Promise<void> {
    this.d.ledger.append({ kind: 'maintain.call', appId: inc.appId, fixId: inc.fixId, signature: inc.diag.signature });
    const stage = join(this.d.pendingRoot, inc.fixId);
    let result: TeamResult;
    try {
      result = await this.d.team(inc, join(stage, 'app'));
    } catch (err) {
      result = { ok: false, reason: `유지보수 팀이 오류로 멈췄어요: ${(err as Error).message}` };
    }
    try {
      if (!result.ok) {
        rmSync(stage, { recursive: true, force: true });
        this.d.ledger.append({ kind: 'maintain.failed', appId: inc.appId, fixId: inc.fixId, reason: result.reason });
        const reason = result.reason;
        this.d.threadNotice(inc.appId, `${dateWord(this.now())} 자동 수정을 시도했지만 고치지 못했어요: ${reason}`);
        this.whenAwake(() => this.d.ui.notifyUnfixed(inc.appId, inc.appName, reason));
        return;
      }
      const fix: PendingFix = { id: inc.fixId, appId: inc.appId, appName: inc.appName, cause: inc.diag.cause, problem: inc.diag.summary, summary: result.summary, createdAt: this.now().toISOString(), announced: false, dir: join(stage, 'app') };
      this.writeMeta(fix);
      this.d.ledger.append({ kind: 'maintain.fixed', appId: inc.appId, fixId: inc.fixId, summary: result.summary });
      if (this.d.autoApply()) {
        const r = await this.apply(fix.id, { auto: true });
        if (r.ok) this.whenAwake(() => this.d.ui.notifyApplied(fix, r.version));
        else this.announce(fix);
      } else this.announce(fix);
    } finally {
      this.inFlight.delete(inc.appId);
      this.pump();
    }
  }

  private announce(fix: PendingFix): void {
    this.whenAwake(() => {
      this.writeMeta({ ...fix, announced: true });
      this.d.ui.offerFix(fix);
    });
  }

  private writeMeta(fix: PendingFix): void {
    const f = join(this.d.pendingRoot, fix.id, 'meta.json');
    writeFileSync(`${f}.tmp`, JSON.stringify(fix, null, 2));
    renameSync(`${f}.tmp`, f);
  }

  /** 보관 대기 중인 수정본 */
  pending(appId?: string): PendingFix[] {
    if (!existsSync(this.d.pendingRoot)) return [];
    return readdirSync(this.d.pendingRoot)
      .flatMap((id) => {
        try {
          const f = JSON.parse(readFileSync(join(this.d.pendingRoot, id, 'meta.json'), 'utf8')) as PendingFix;
          return existsSync(f.dir) ? [{ ...f, dir: join(this.d.pendingRoot, id, 'app') }] : [];
        } catch {
          return [];
        }
      })
      .filter((f) => appId === undefined || f.appId === appId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** 사용자가 [적용]을 눌렀거나 자동 적용이 켜져 있다 */
  async apply(fixId: string, o: { auto?: boolean } = {}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
    const fix = this.pending().find((f) => f.id === fixId);
    if (!fix) return { ok: false, error: '대기 중인 수정본이 없어요' };
    const r = await this.d.applyFix(fix.dir, fix.appId);
    if (!r.ok) {
      this.d.ledger.append({ kind: 'maintain.apply.failed', appId: fix.appId, fixId, error: r.error });
      return r;
    }
    rmSync(join(this.d.pendingRoot, fixId), { recursive: true, force: true });
    this.d.ledger.append({ kind: 'maintain.applied', appId: fix.appId, fixId, version: r.version, auto: o.auto === true });
    this.d.threadNotice(fix.appId, `${dateWord(this.now())} 자동 수정${o.auto ? '(자동 적용)' : ''}: ${fix.problem}. ${fix.summary}`);
    return r;
  }

  dismiss(fixId: string): boolean {
    const fix = this.pending().find((f) => f.id === fixId);
    if (!fix) return false;
    rmSync(join(this.d.pendingRoot, fixId), { recursive: true, force: true });
    this.d.ledger.append({ kind: 'maintain.dismissed', appId: fix.appId, fixId });
    return true;
  }

  /** 앱 상세에 보일 유지보수 기록(최근 30일, 새것부터) */
  history(appId: string): { at: string; kind: string; text: string }[] {
    const text = (e: LedgerEvent): string | null => {
      switch (e.kind) {
        case 'maintain.advice': return '문제를 알렸어요';
        case 'maintain.call': return '유지보수 팀이 고치기 시작했어요';
        case 'maintain.fixed': return `고친 버전을 만들었어요: ${String(e.summary ?? '')}`;
        case 'maintain.applied': return `수정을 적용했어요${e.auto ? '(자동)' : ''}`;
        case 'maintain.failed': return `고치지 못했어요: ${String(e.reason ?? '')}`;
        case 'maintain.dismissed': return '수정본을 쓰지 않기로 했어요';
        case 'maintain.skipped': return e.reason === 'cooldown' ? '방금 고치지 못해서 잠시 쉬어요' : '오늘은 이미 여러 번 시도해서 쉬어요';
        default: return null;
      }
    };
    return this.d.ledger.read({ days: 30, appId }).flatMap((e) => { const t = text(e); return t ? [{ at: e.at, kind: e.kind, text: t }] : []; }).reverse();
  }

  /** 1분마다. 아침이 되면 모아 둔 것을 보여 주고, 미룬 팀 호출을 다시 본다 */
  tick(): void {
    if (this.stopped) return;
    if (!isQuiet(this.now(), this.cfg)) {
      for (const fn of this.deferred.splice(0)) fn();
      for (const f of this.pending().filter((x) => !x.announced)) this.announce(f);
    }
    this.pump();
  }
}
