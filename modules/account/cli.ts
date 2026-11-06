/**
 * 사용자가 깔아 둔 공식 CLI(claude, codex)를 찾고, 로그인 상태를 묻는다. 토큰은 읽지도 저장하지도 않는다.
 * 스튜디오(hack-collaboration-studio src/login.ts)에서 가져왔다.
 */
import { accessSync, constants, existsSync, readdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export type Vendor = 'claude' | 'codex';
export const VENDORS: readonly Vendor[] = ['claude', 'codex'];

export interface CliStatus {
  loggedIn: boolean;
  email: string | null;
  /** 구독 종류(max, pro, plus …). Codex는 status가 알려 주지 않아 null */
  plan: string | null;
  /** 로그인 방식(Claude: claude.ai, Codex: ChatGPT …) */
  method: string | null;
  /** 같은 계정인지 가리는 값(Claude만: 메일|조직). 같은 계정에 두 번 로그인하면 한도를 같이 쓴다 */
  identity: string | null;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// 이 변수들이 자식 CLI에 닿으면 구독이 아니라 종량제 API로 조용히 과금된다. 늘 뗀다.
const API_KEY_VARS = new Set(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY']);
// HackMac을 Claude Code 세션이나 VS Code 터미널에서 켜면 그 세션의 표지가 따라 들어가 자식이 그 세션의 하위로 기록된다.
// ELECTRON_RUN_AS_NODE도 뗀다: 자식이 Electron 바이너리를 부르면(팝업 클라이언트 등) 엉뚱하게 Node로 뜬다.
const SESSION_MARKER = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|VSCODE_|ELECTRON_RUN_AS_NODE$)/;

export const cleanEnv = (extra: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !API_KEY_VARS.has(k) && !SESSION_MARKER.test(k)) out[k] = v;
  return { ...out, ...extra };
};

/**
 * 그 CLI를 부를 자식 환경. CLI가 있는 폴더를 PATH 맨 앞에 붙인다: npm·fnm·nvm으로 깐 codex는 `#!/usr/bin/env node`
 * 스크립트라, Finder·launchd로 뜬 HackMac(터미널 PATH 없음)에서는 같은 폴더의 node를 찾지 못해 뜨지 않는다.
 */
export const envFor = (bin: string, extra: Record<string, string> = {}, base: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const env = cleanEnv(extra, base);
  const dir = dirname(bin);
  const rest = (env.PATH ?? '').split(delimiter).filter((p) => p && p !== dir);
  return { ...env, PATH: [dir, ...rest, '/usr/bin', '/bin'].filter((p, i, a) => a.indexOf(p) === i).join(delimiter) };
};

/** 기본 계정이 아니면 그 계정의 설정 폴더를 CLI에 알려 주는 환경변수 */
export const accountEnv = (vendor: Vendor, configDir: string | null): Record<string, string> =>
  configDir === null ? {} : vendor === 'claude' ? { CLAUDE_CONFIG_DIR: configDir } : { CODEX_HOME: configDir };

// 폴더 안의 하위 폴더마다 sub를 붙인 경로들(예: ~/.nvm/versions/node 아래 버전별 bin). 폴더가 없으면 빈 목록
const under = (root: string, sub: string): string[] => {
  try {
    return existsSync(root) ? readdirSync(root).sort().reverse().map((n) => join(root, n, sub)) : [];
  } catch {
    return [];
  }
};

/** CLI를 찾을 폴더들. 공식 설치 위치(~/.local/bin)를 맨 앞에 둔다: Finder나 launchd로 뜬 HackMac은 터미널 PATH를 못 받는다 */
export const searchDirs = (home = homedir(), path = process.env.PATH ?? ''): string[] => [
  join(home, '.local', 'bin'),
  ...path.split(delimiter).filter(Boolean),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(home, '.volta', 'bin'),
  ...under(join(home, '.local', 'share', 'fnm', 'node-versions'), join('installation', 'bin')),
  ...under(join(home, '.nvm', 'versions', 'node'), 'bin'),
];

export const resolveBin = (name: string, dirs: string[] = searchDirs()): string | null => {
  for (const d of dirs) {
    try {
      accessSync(join(d, name), constants.X_OK);
      return join(d, name);
    } catch {
      // 없는 폴더는 건너뛴다
    }
  }
  return null;
};

export const run = (bin: string, args: string[], env: Record<string, string>, timeout = 20_000, cwd?: string): Promise<{ code: number; out: string }> =>
  new Promise((done) =>
    execFile(bin, args, { env, timeout, maxBuffer: 1 << 20, cwd }, (err, stdout, stderr) =>
      done({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: `${stdout}${stderr}`.replace(ANSI, '') }),
    ),
  );

/** `claude auth status --json`의 답에서 읽는 칸 */
export const parseClaudeStatus = (out: string): CliStatus | null => {
  try {
    const j = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, unknown>;
    const loggedIn = j.loggedIn === true && j.authMethod !== 'none';
    const email = typeof j.email === 'string' ? j.email : null;
    return {
      loggedIn,
      email,
      plan: typeof j.subscriptionType === 'string' ? j.subscriptionType : null,
      method: typeof j.authMethod === 'string' && j.authMethod !== 'none' ? j.authMethod : null,
      identity: loggedIn && email ? `${email}|${typeof j.orgId === 'string' ? j.orgId : ''}` : null,
    };
  } catch {
    return null;
  }
};

/** Codex는 JSON이 없다. "Logged in using ChatGPT" 한 줄과 종료 코드만 본다 */
export const parseCodexStatus = (code: number, out: string): CliStatus => ({
  loggedIn: code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out),
  email: null,
  plan: null,
  method: /logged in using ([^\n]+)/i.exec(out)?.[1]?.trim() ?? null,
  identity: null,
});

export interface StatusDeps {
  bin: (name: Vendor) => string | null;
  run: typeof run;
}

/** CLI에 로그인 상태를 묻는다. CLI가 없으면 { installed: false }. 답을 못 읽으면 status null(아직 모른다) */
export const cliStatus = async (
  vendor: Vendor,
  env: Record<string, string> = {},
  deps: StatusDeps = { bin: (n) => resolveBin(n), run },
): Promise<{ installed: boolean; bin: string | null; status: CliStatus | null }> => {
  const bin = deps.bin(vendor);
  if (!bin) return { installed: false, bin: null, status: null };
  if (vendor === 'claude') {
    const r = await deps.run(bin, ['auth', 'status', '--json'], envFor(bin, env));
    return { installed: true, bin, status: parseClaudeStatus(r.out) };
  }
  const r = await deps.run(bin, ['login', 'status'], envFor(bin, env));
  return { installed: true, bin, status: parseCodexStatus(r.code, r.out) };
};
