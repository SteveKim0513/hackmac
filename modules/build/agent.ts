/**
 * 제작 에이전트 설정. 지시문 조립, 회사별 도구·격리, 제작 명령 환경을 한곳에서 정한다.
 *
 * 격리(계획서 10.1) — 에이전트는 승인 없이 돌되 작업 폴더 밖에 쓰지 못한다(2026-11-06 실측):
 *   Claude: 샌드박스(sandbox.enabled)는 셸(Bash)만 막는다. 파일 도구(Write/Edit)는 샌드박스를 안 거쳐 홈에 그대로 썼다.
 *           그래서 Write·Edit를 `./**`로 좁혀 허용한다(dontAsk라 그 밖은 거부). 작업 폴더는 실제 경로여야 한다.
 *   Codex:  thread의 sandbox=workspace-write가 작업 폴더와 /tmp 밖 쓰기를 막는다. 샌드박스 안에서도 Electron-Node 실행은 된다.
 */
import { join } from 'node:path';
import type { Vendor } from '../account/cli.ts';
import type { ConversationOptions } from '../conversation/types.ts';

export const CLAUDE_BUILD_TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'Edit(./**)', 'Write(./**)', 'WebFetch', 'WebSearch'];
export const CLAUDE_SANDBOX_SETTINGS = { sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false } };

export interface AgentPaths {
  buildWrapper: string;
  buildClientJs: string;
  electronBin: string;
  docs: { label: string; path: string }[];
}

/** builder.md의 {DOCS}를 문서 목록으로 채우고, 능력 목록 전문을 뒤에 붙인다(가장 자주 봐야 해서 파일을 읽게 두지 않는다) */
export const builderInstructions = (template: string, capabilities: string, docs: AgentPaths['docs']): string =>
  `${template.replace('{DOCS}', docs.map((d) => `- ${d.label}: ${d.path}`).join('\n'))}\n\n---\n\n${capabilities}`;

/** 엔진 프로세스(그리고 그 셸)에 줄 환경 */
export const buildEnv = (cwd: string, p: AgentPaths): Record<string, string> => ({
  HACKMAC_BUILD: p.buildWrapper,
  HACKMAC_BUILD_CLIENT_JS: p.buildClientJs,
  HACKMAC_ELECTRON_BIN: p.electronBin,
  HACKMAC_BUILD_DIR: join(cwd, '.hackmac'),
});

export const agentOptions = (vendor: Vendor, cwd: string, p: AgentPaths): Partial<ConversationOptions> =>
  vendor === 'claude'
    ? { allowedTools: CLAUDE_BUILD_TOOLS, extraArgs: ['--settings', JSON.stringify(CLAUDE_SANDBOX_SETTINGS)], env: buildEnv(cwd, p) }
    : { env: buildEnv(cwd, p) };

/**
 * 전문 담당의 지시문: 역할 글 + (만드는 담당이면) 패키지 규칙과 능력 목록. 역할마다 필요한 것만 준다 —
 * 감사·채점 담당에게 패키지 규칙 전문을 주지 않는 것은 "어떻게 만들지"가 아니라 "무엇이 되면 되는지"만 보게 하려는 것.
 */
export const roleInstructions = (
  roleMd: string,
  o: { packageSpec?: string; capabilities?: string; copyGuidePath?: string; docs?: AgentPaths['docs'] },
): string =>
  [
    roleMd.replace('{COPY_GUIDE}', o.copyGuidePath ?? '(없음)'),
    ...(o.packageSpec ? ['---', o.packageSpec] : []),
    ...(o.capabilities ? ['---', o.capabilities] : []),
    ...(o.docs?.length ? ['---', '## 참고 문서 (읽기 전용)', ...o.docs.map((d) => `- ${d.label}: ${d.path}`)] : []),
  ].join('\n\n');

/** 설치된 앱을 고치는 스레드에서 요구 정리 담당에게 붙는 사정(앱 상세의 [수정하기]) */
export const editContext = (appId: string, version: number, reqCount: number): string =>
  [
    '## 지금 하는 일: 설치된 앱 고치기',
    `이 스레드는 이미 설치된 앱(${appId}, 이 맥의 ${version}번째 버전)을 고치는 중이다. 작업 폴더의 ./app/ 에 지금 설치된 버전이 그대로 있다.`,
    '- 사용자가 무엇을 바꾸고 싶은지 듣는다. 기준 캐내기를 그대로 한다(잘 된 모습, 없을 때·안 될 때, 바꾸고 싶을 값).',
    reqCount > 0
      ? `- 기존 요구사항 ${reqCount}개는 그대로 유효하다. 바뀌는 것은 같은 번호로 req를 다시 쓰고, 새 것은 다음 번호로 더한다. 빼기로 한 것만 req-remove.`
      : '- 기록된 요구사항이 없다(작업실 밖에서 온 앱). 먼저 ./app/ 의 선언과 스크립트를 읽고 지금 하는 일을 R1, R2 …로 기록해 사용자에게 "지금 이 앱은 이렇게 동작해요"라고 확인받은 뒤, 바꿀 것을 더한다.',
    '- 확정되면 evaluate → handoff. 전문 담당들이 버전을 올려 다시 설치한다(기존 요구사항도 모두 다시 확인한다).',
  ].join('\n');
