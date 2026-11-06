/**
 * 유지보수 팀(계획서 11.3). 새 맥락의 별도 역할이 격리 폴더에서 수정본을 만든다.
 *   - 입력: 앱 패키지 복사본, 실패 로그, 최근 사건 원장, 스레드의 최근 대화(압축 기억이 생기면 그것으로 바꾼다 — 12.2)
 *   - 도구·격리·`$HACKMAC_BUILD`는 앱 제작과 같다(modules/build). Builder를 fix 모드로 써서 검증 게이트를 그대로 통과해야 한다.
 *   - "설치"는 하지 않는다: 통과한 수정본은 보관 대기 폴더(stageDir)에 복사한다. 새 버전이 되는 건 사용자가 [적용]을 누를 때다.
 * 사용자가 작업실에서 쓰는 대화(스레드)와 따로 한 번 쓰고 닫는 엔진을 연다.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Vendor } from '../account/cli.ts';
import { agentOptions, type AgentPaths } from '../build/agent.ts';
import { Builder } from '../build/builder.ts';
import type { GateOptions } from '../build/gate.ts';
import { askOnce } from '../conversation/once.ts';
import type { ConversationOptions } from '../conversation/types.ts';
import type { Incident, TeamResult } from './maintainer.ts';

export interface TeamDeps {
  currentPackage: (appId: string) => string | null;
  installedVersion: (appId: string) => string | null;
  gate: Omit<GateOptions, 'requirements' | 'installedVersion'>;
  /** 팀이 쓸 엔진. 없으면(로그인 안 됨) 못 고친다 */
  engine: () => { vendor: Vendor; bin: string; env: Record<string, string> } | null;
  agentPaths: AgentPaths;
  /** maintainer.md를 {DOCS}까지 채우고 능력 목록을 붙인 지시문 */
  instructions: string;
  ledgerText: (appId: string) => string;
  memoryText: (appId: string) => string;
  /** 시험용: 엔진을 어떻게 돌릴지 바꾼다 */
  runAgent?: (vendor: Vendor, o: ConversationOptions, prompt: string, timeoutMs: number) => Promise<string>;
  workRoot?: string;
  timeoutMs?: number;
}

const tail = (s: string, n: number): string => (s.length > n ? `…${s.slice(-n)}` : s);

export const incidentText = (i: Incident): string =>
  [
    `# 사건: ${i.appName} (${i.appId})`,
    '',
    `- 원인 분류(코드가 판정): ${i.diag.cause}`,
    `- 요약: ${i.diag.summary}`,
    `- 근거 줄: ${i.diag.evidence}`,
    `- 하루 안에 같은 실패가 ${i.occurrences}번 되풀이됐다`,
    `- 일어난 때: ${i.at}`,
  ].join('\n');

export const teamPrompt = (i: Incident): string =>
  [
    '너는 HackMac 유지보수 팀이다(지시문 참고). 설치된 앱 하나가 실패해서 불려 왔다.',
    `앱: ${i.appName} (${i.appId})`,
    `증상: ${i.diag.summary}`,
    `근거: ${i.diag.evidence}`,
    '',
    '작업 폴더의 context/incident.md와 context/log.txt를 읽고, ./app을 고쳐 검증을 통과시킨 뒤 submit 한다.',
    '코드로 고칠 수 없는 원인이면 수정본을 내지 말고 "고칠 수 없음: 이유"로 답한다.',
  ].join('\n');

export const createTeam = (d: TeamDeps) =>
  async (inc: Incident, stageDir: string): Promise<TeamResult> => {
    const pkg = d.currentPackage(inc.appId);
    if (!pkg) return { ok: false, reason: '고칠 앱의 현재 버전을 찾지 못했어요' };
    const engine = d.engine();
    if (!engine) return { ok: false, reason: '유지보수에 쓸 AI 계정이 로그인돼 있지 않아요' };

    const root = d.workRoot ?? tmpdir();
    mkdirSync(root, { recursive: true });
    const work = realpathSync(mkdtempSync(join(root, 'hackmac-fix-')));
    const progressFile = `${work}.progress.jsonl`;
    let builder: Builder | null = null;
    try {
      cpSync(pkg, join(work, 'app'), { recursive: true, dereference: false });
      mkdirSync(join(work, 'context'));
      writeFileSync(join(work, 'context', 'incident.md'), incidentText(inc));
      writeFileSync(join(work, 'context', 'log.txt'), tail(inc.log, 6000));
      writeFileSync(join(work, 'context', 'ledger.txt'), tail(d.ledgerText(inc.appId), 4000));
      writeFileSync(join(work, 'context', 'memory.txt'), tail(d.memoryText(inc.appId), 4000));

      let appIdOk = true;
      builder = new Builder({
        mode: 'fix',
        workDir: work,
        progressFile,
        gate: d.gate,
        evaluator: () => null,
        evaluateContext: { capabilities: '', macosVersion: '' },
        installedVersion: d.installedVersion,
        install: (pkgDir) => {
          let id = '';
          try {
            id = String((JSON.parse(readFileSync(join(pkgDir, 'manifest.json'), 'utf8')) as { id?: unknown }).id ?? '');
          } catch { /* 게이트가 이미 걸렀다 */ }
          if (id !== inc.appId) { appIdOk = false; return { ok: false, errors: [`앱 id를 바꿀 수 없다(${inc.appId}여야 한다)`] }; }
          rmSync(stageDir, { recursive: true, force: true });
          mkdirSync(dirname(stageDir), { recursive: true });
          cpSync(pkgDir, stageDir, { recursive: true, dereference: false });
          // 새 버전 번호는 사용자가 적용할 때 보관소가 정한다. 여기서는 보관만 했다
          return { ok: true, id, version: 0 };
        },
        onState: () => {},
      });
      builder.start();

      const opts = agentOptions(engine.vendor, work, d.agentPaths);
      const o: ConversationOptions = {
        bin: engine.bin,
        cwd: work,
        env: { ...engine.env, ...(opts.env ?? {}) },
        instructions: d.instructions,
        ...(opts.allowedTools ? { allowedTools: opts.allowedTools } : {}),
        ...(opts.extraArgs ? { extraArgs: opts.extraArgs } : {}),
      };
      const run = d.runAgent ?? ((v, oo, p, t) => askOnce(v, oo, p, t));
      let answer: string;
      try {
        answer = await run(engine.vendor, o, teamPrompt(inc), d.timeoutMs ?? 15 * 60_000);
      } catch (err) {
        return { ok: false, reason: `유지보수 팀이 끝까지 하지 못했어요: ${(err as Error).message}` };
      }
      await builder.inbox.poll(); // 마지막 요청까지 처리한 뒤 상태를 본다
      const state = builder.state();
      const text = answer.replace(/[*`#]/g, '').trim();
      if (state.installed) return { ok: true, summary: text.slice(0, 400) || `${inc.diag.summary} 부분을 고쳤어요.` };
      if (/^고칠 수 없음/.test(text)) return { ok: false, reason: text.replace(/^고칠 수 없음:?\s*/, '').slice(0, 300) || '코드로 고칠 수 있는 문제가 아니에요' };
      if (!appIdOk) return { ok: false, reason: '수정본이 앱 id를 바꿔서 보관하지 않았어요' };
      if (state.gate && !state.gate.ok) return { ok: false, reason: '수정본이 검증을 통과하지 못했어요' };
      return { ok: false, reason: '수정본을 내지 않고 끝났어요' };
    } finally {
      builder?.stop();
      rmSync(work, { recursive: true, force: true });
      rmSync(progressFile, { force: true });
    }
  };
