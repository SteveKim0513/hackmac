import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chooseEngine } from './choose.ts';
import { accountEnv, cleanEnv, cliStatus, parseClaudeStatus, parseCodexStatus, resolveBin, searchDirs } from './cli.ts';
import { createLogins, fileLogger } from './login.ts';

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'hackmac-account-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const until = async (pred: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 20)); }
};

const script = (name: string, body: string): string => {
  const p = join(tmp, name);
  writeFileSync(p, `#!/bin/zsh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
};

describe('cli', () => {
  it('API 키와 세션 표지를 뗀다', () => {
    const env = cleanEnv({ X: '1' }, { PATH: '/bin', ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', ELECTRON_RUN_AS_NODE: '1', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', X: '1' });
  });

  it('기본 계정이 아니면 설정 폴더 변수', () => {
    expect(accountEnv('claude', null)).toEqual({});
    expect(accountEnv('claude', '/a')).toEqual({ CLAUDE_CONFIG_DIR: '/a' });
    expect(accountEnv('codex', '/b')).toEqual({ CODEX_HOME: '/b' });
  });

  it('~/.local/bin을 PATH보다 먼저 본다', () => {
    const home = join(tmp, 'home');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    mkdirSync(join(tmp, 'p'));
    writeFileSync(join(home, '.local', 'bin', 'claude'), '');
    chmodSync(join(home, '.local', 'bin', 'claude'), 0o755);
    writeFileSync(join(tmp, 'p', 'claude'), '');
    chmodSync(join(tmp, 'p', 'claude'), 0o755);
    expect(resolveBin('claude', searchDirs(home, join(tmp, 'p')))).toBe(join(home, '.local', 'bin', 'claude'));
    expect(resolveBin('nope', searchDirs(home, join(tmp, 'p')))).toBeNull();
  });

  it('claude auth status JSON을 읽는다(실제 2.1.318 출력 모양)', () => {
    const s = parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","orgId":"o1","subscriptionType":"max"}');
    expect(s).toEqual({ loggedIn: true, email: 'a@b.c', plan: 'max', method: 'claude.ai', identity: 'a@b.c|o1' });
    expect(parseClaudeStatus('{"loggedIn":false,"authMethod":"none"}')).toMatchObject({ loggedIn: false, method: null, identity: null });
    expect(parseClaudeStatus('깨진 출력')).toBeNull();
  });

  it('codex login status 한 줄을 읽는다', () => {
    expect(parseCodexStatus(0, 'Logged in using ChatGPT\n')).toMatchObject({ loggedIn: true, method: 'ChatGPT' });
    expect(parseCodexStatus(1, 'Not logged in\n')).toMatchObject({ loggedIn: false });
  });

  it('CLI가 없으면 installed=false', async () => {
    expect(await cliStatus('codex', {}, { bin: () => null, run: async () => ({ code: 0, out: '' }) })).toEqual({ installed: false, bin: null, status: null });
    const r = await cliStatus('codex', {}, { bin: () => '/x/codex', run: async (_b, args) => ({ code: 0, out: args.join(' ') === 'login status' ? 'Logged in using ChatGPT' : '' }) });
    expect(r).toMatchObject({ installed: true, bin: '/x/codex', status: { loggedIn: true } });
  });
});

describe('chooseEngine', () => {
  const st = (c: [boolean, boolean], x: [boolean, boolean]) => ({ claude: { installed: c[0], loggedIn: c[1] }, codex: { installed: x[0], loggedIn: x[1] } });
  it('0개면 로그인, 1개면 그것, 2개면 묻거나 저장된 것', () => {
    expect(chooseEngine(st([false, false], [true, false]), null)).toEqual({ kind: 'login', installed: ['codex'] });
    expect(chooseEngine(st([true, true], [true, false]), null)).toEqual({ kind: 'use', vendor: 'claude', switchedFrom: null });
    expect(chooseEngine(st([true, true], [true, true]), null)).toEqual({ kind: 'ask', options: ['claude', 'codex'] });
    expect(chooseEngine(st([true, true], [true, true]), 'codex')).toEqual({ kind: 'use', vendor: 'codex', switchedFrom: null });
  });
  it('저장된 엔진이 로그아웃되면 남은 쪽을 쓰고 알린다', () => {
    expect(chooseEngine(st([true, true], [true, false]), 'codex')).toEqual({ kind: 'use', vendor: 'claude', switchedFrom: 'codex' });
  });
});

describe('createLogins', () => {
  it('Claude: 주소를 보이고 코드를 받아 넘기면 끝난다', async () => {
    const bin = script('claude', 'echo "Opening https://claude.ai/oauth/authorize?code=true&x=1"\necho "Paste code here if prompted >"\nread c\n[[ "$c" == "good-code" ]] && echo ok && exit 0\nexit 3');
    const logs = join(tmp, 'logs');
    const logins = createLogins({ spawn, bin: () => bin, log: fileLogger(logs) });
    let result: boolean | null = null;
    const v0 = logins.start('claude', 'claude', {}, (ok) => { result = ok; });
    expect(v0.state).toBe('pending');
    await until(() => logins.state('claude')?.needsCode === true);
    expect(logins.state('claude')).toMatchObject({ url: 'https://claude.ai/oauth/authorize?code=true&x=1', needsCode: true });
    logins.submit('claude', '  good-code \n');
    await until(() => result !== null);
    expect(result).toBe(true);
    expect(logins.state('claude')).toMatchObject({ state: 'done', needsCode: false });
    expect(readFileSync(join(logs, 'login-claude.log'), 'utf8')).toContain('코드를 받아 CLI에 넘김');
  });

  it('Codex: 코드 입력 없이 CLI가 끝나면 성공, 이미 진행 중이면 같은 흐름을 돌려준다', async () => {
    const bin = script('codex', 'echo "Starting local login server on http://localhost:1455."\necho "If your browser did not open, navigate to this URL to authenticate: https://auth.openai.com/oauth/authorize?a=b"\nsleep 0.3\necho "Successfully logged in"\nexit 0');
    const logins = createLogins({ spawn, bin: () => bin });
    let result: boolean | null = null;
    logins.start('codex', 'codex', {}, (ok) => { result = ok; });
    expect(logins.start('codex', 'codex', {}, () => {}).state).toBe('pending');
    await until(() => logins.state('codex')?.url !== null);
    expect(logins.state('codex')).toMatchObject({ url: 'https://auth.openai.com/oauth/authorize?a=b', needsCode: false });
    await until(() => result !== null);
    expect(result).toBe(true);
  });

  it('CLI가 없으면 바로 failed, 실패 종료면 failed', async () => {
    expect(createLogins({ spawn, bin: () => null }).start('x', 'claude', {}, () => {})).toMatchObject({ state: 'failed' });
    const bin = script('claude', 'echo "boom" >&2; exit 2');
    const logins = createLogins({ spawn, bin: () => bin });
    let result: boolean | null = null;
    logins.start('c', 'claude', {}, (ok) => { result = ok; });
    await until(() => result !== null);
    expect(result).toBe(false);
    expect(logins.state('c')).toMatchObject({ state: 'failed', output: expect.stringContaining('boom') });
  });
});
