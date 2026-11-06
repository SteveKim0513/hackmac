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
