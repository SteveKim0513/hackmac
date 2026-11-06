import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInstalls, INSTALL_SCRIPT, installEnv, type InstallView } from './install.ts';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'hackmac-install-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const until = async (pred: () => boolean, ms = 10_000) => {
  const t0 = Date.now();
  while (!pred()) { if (Date.now() - t0 > ms) throw new Error('기다리다 지침'); await new Promise((r) => setTimeout(r, 20)); }
};

/** 진짜 설치기 흉내: ~/.local/bin에 --version에 답하는 실행 파일을 둔다 */
const fakeInstaller = (name: string, version: string) =>
  `echo "Downloading ${name}..."; mkdir -p "$HOME/.local/bin"; printf '#!/bin/sh\\necho "${version}"\\n' > "$HOME/.local/bin/${name}"; chmod +x "$HOME/.local/bin/${name}"; echo "✅ Installation complete!"; echo "PATH=$PATH" > "$HOME/seen-path"; echo "NI=$CODEX_NON_INTERACTIVE" >> "$HOME/seen-path"`;

const run = async (scripts: Record<string, string>, vendor: 'claude' | 'codex', timeoutMs?: number) => {
  const installs = createInstalls({ spawn, home, scripts, timeoutMs });
  let ok: boolean | null = null;
  installs.start(vendor, (x) => { ok = x; });
  await until(() => ok !== null);
  return { ok, view: installs.state(vendor) as InstallView };
};

describe('createInstalls', () => {
  it('공식 명령은 조사에서 정한 그대로', () => {
    expect(INSTALL_SCRIPT.claude).toBe('curl -fsSL https://claude.ai/install.sh | bash -s stable');
    expect(INSTALL_SCRIPT.codex).toBe('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
  });

  it('설치기 환경: ~/.local/bin이 PATH 맨 앞(쉘 설정 파일을 안 건드리게), 비대화, API 키 없음', () => {
    const env = installEnv('/h', { PATH: '/usr/local/bin:/usr/bin', OPENAI_API_KEY: 'k', SHELL: '/bin/zsh' });
    expect(env.PATH.split(':')[0]).toBe('/h/.local/bin');
    expect(env.CODEX_NON_INTERACTIVE).toBe('1');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.HOME).toBe('/h');
  });

  it('설치 뒤 실행 파일이 --version에 답하면 done', async () => {
    const { ok, view } = await run({ codex: fakeInstaller('codex', 'codex-cli 9.9.9') }, 'codex');
    expect(ok).toBe(true);
    expect(view).toMatchObject({ state: 'done', bin: join(home, '.local', 'bin', 'codex'), version: 'codex-cli 9.9.9', error: null });
    expect(view.output).toContain('Installation complete');
    const seen = readFileSync(join(home, 'seen-path'), 'utf8');
    expect(seen).toContain(`PATH=${join(home, '.local', 'bin')}:`);
    expect(seen).toContain('NI=1');
  });

  it('스크립트가 실패하면(파이프 앞쪽 실패 포함) failed와 마지막 줄', async () => {
    const r1 = await run({ claude: 'echo "Unsupported architecture" >&2; exit 1' }, 'claude');
    expect(r1).toMatchObject({ ok: false, view: { state: 'failed', error: expect.stringContaining('Unsupported architecture') } });
    // curl이 실패해 빈 입력이 bash로 가도(pipefail) 실패로 본다
    const r2 = await run({ claude: 'false | bash' }, 'claude');
    expect(r2.view.state).toBe('failed');
  });

  it('스크립트가 성공해도 실행 파일이 없으면 failed', async () => {
    const { view } = await run({ claude: 'echo done' }, 'claude');
    expect(view).toMatchObject({ state: 'failed', error: '설치 뒤 claude를 찾지 못했어요' });
  });

  it('멈춘 설치는 시간 초과로 끊는다', async () => {
    const { view } = await run({ codex: 'sleep 30' }, 'codex', 300);
    expect(view).toMatchObject({ state: 'failed', error: expect.stringContaining('끝나지 않았어요') });
  });

  it('진행 중이면 같은 작업을 돌려준다', async () => {
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    const installs = createInstalls({ spawn, home, scripts: { codex: `sleep 0.3; ${fakeInstaller('codex', 'v1')}` } });
    let n = 0;
    installs.start('codex', () => n++);
    expect(installs.start('codex', () => n++).state).toBe('running');
    await until(() => n > 0);
    await new Promise((r) => setTimeout(r, 200));
    expect(n).toBe(1);
    expect(existsSync(join(home, '.local', 'bin', 'codex'))).toBe(true);
  });
});
