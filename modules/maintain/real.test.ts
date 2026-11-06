/**
 * 진짜 엔진이 유지보수 팀으로 일하는지 본다(구독 사용량을 쓰므로 평소엔 건너뛴다):
 *   HACKMAC_REAL_ENGINES=1 npx vitest run modules/maintain/real.test.ts
 * 일부러 깨뜨린 앱(문법 오류 + 시험 없음)을 주고, 지시문(resources/agent/maintainer.md)대로 고쳐 검증을 통과하는지 본다.
 * 고칠 수 없는 원인(권한 거부)은 수정본 없이 "고칠 수 없음"으로 답하는지도 본다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanEnv, cliStatus, envFor, type Vendor } from '../account/cli.ts';
import { builderInstructions } from '../build/agent.ts';
import { classify } from './classify.ts';
import type { Incident } from './maintainer.ts';
import { createTeam } from './team.ts';

const REAL = process.env.HACKMAC_REAL_ENGINES === '1';
const CWD = process.cwd();
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hackmac-realfix-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const manifest = {
  schema: 1, id: 'my.greeter', version: '1', author: { name: 'me', signature: null }, hackmac: { min: '2.0.0' },
  name: '인사 앱', icon: '👋', tagline: '{hotkey:hi} 누르면 이름을 묻고 인사해요', usage: ['{hotkey:hi}'],
  triggers: [{ kind: 'hotkey', script: 'scripts/hi.sh', key: 'hi', name: '인사하기', description: '이름을 물어 인사를 남긴다' }],
  capabilities: { popup: '>=1' }, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false }, settings: [], secrets: [], references: [],
};

// if 문을 닫지 않았다(parse error)
const BROKEN = `#!/bin/zsh
name=$("$HACKMAC_POPUP" prompt --title 인사 --prompt 이름 --ok 확인 --cancel 취소 --default 친구) || exit 0
echo "판단: 이름=$name"
if [[ -n "$name" ]]; then
  print -r -- "안녕, $name" > "$HACKMAC_DATA_DIR/last.txt"
`;

const incident = (log: string): Incident => ({ fixId: 'fix-real', appId: 'my.greeter', appName: '인사 앱', occurrences: 2, at: new Date().toISOString(), diag: classify({ code: 1, signal: null, log, appName: '인사 앱' })!, log });

for (const vendor of ['claude', 'codex'] as Vendor[]) {
  describe.skipIf(!REAL)(`실제 ${vendor} 유지보수 팀`, () => {
    const setup = async () => {
      const st = await cliStatus(vendor);
      expect(st.status?.loggedIn).toBe(true);
      const installed = join(root, vendor, 'installed');
      mkdirSync(join(installed, 'scripts'), { recursive: true });
      writeFileSync(join(installed, 'manifest.json'), JSON.stringify(manifest));
      writeFileSync(join(installed, 'scripts', 'hi.sh'), BROKEN);
      const capabilities = readFileSync(join(CWD, 'resources', 'agent', 'capabilities.md'), 'utf8');
      const instructions = builderInstructions(readFileSync(join(CWD, 'resources', 'agent', 'maintainer.md'), 'utf8'), capabilities, []);
      return createTeam({
        currentPackage: () => installed,
        installedVersion: () => '1',
        gate: { capabilities: { popup: 1 }, realHome: homedir(), popupStub: join(CWD, 'resources', 'bin', 'hackmac-popup-stub') },
        engine: () => ({ vendor, bin: st.bin!, env: envFor(st.bin!, {}, cleanEnv()) }),
        agentPaths: { buildWrapper: join(CWD, 'resources', 'bin', 'hackmac-build'), buildClientJs: join(CWD, 'resources', 'bin', 'hackmac-build-client.cjs'), electronBin: join(CWD, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), docs: [] },
        instructions,
        ledgerText: () => '(최근 사건 없음)',
        memoryText: () => '사용자: 단축키를 누르면 이름을 묻고 "안녕, 이름"을 파일에 남기는 앱을 만들어 줘.',
        workRoot: join(root, vendor, 'work'),
        timeoutMs: 600_000,
      });
    };

    it('문법이 깨진 앱을 고치고, 시험을 더하고, 버전을 올려 검증을 통과한다', async () => {
      const team = await setup();
      const stage = join(root, vendor, 'pending', 'fix-real', 'app');
      const log = `${execFileSync('/bin/zsh', ['-c', 'zsh -n "$1" 2>&1 || true', 'x', join(root, vendor, 'installed', 'scripts', 'hi.sh')], { encoding: 'utf8' })}\n종료 코드: 1`;
      const r = await team(incident(log), stage);
      console.log(`[${vendor}] 결과`, JSON.stringify(r));
      expect(r.ok).toBe(true);
      const m = JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8'));
      expect(m.id).toBe('my.greeter');
      expect(Number(m.version)).toBeGreaterThan(1);
      expect(() => execFileSync('/bin/zsh', ['-n', join(stage, 'scripts', 'hi.sh')])).not.toThrow();
      expect(existsSync(join(stage, 'checks'))).toBe(true);
      console.log(`[${vendor}] 고친 스크립트:\n${readFileSync(join(stage, 'scripts', 'hi.sh'), 'utf8')}`);
      // 설치된 원본은 그대로
      expect(readFileSync(join(root, vendor, 'installed', 'scripts', 'hi.sh'), 'utf8')).toBe(BROKEN);
    }, 700_000);

    it('권한 거부처럼 코드로 고칠 수 없는 원인은 수정본 없이 "고칠 수 없음"으로 답한다', async () => {
      const team = await setup();
      const stage = join(root, vendor, 'pending', 'fix-real-2', 'app');
      const r = await team(incident('execution error: Not authorized to send Apple events to Reminders. (-1743)\n종료 코드: 1'), stage);
      console.log(`[${vendor}] 결과`, JSON.stringify(r));
      expect(r.ok).toBe(false);
      expect(existsSync(stage)).toBe(false);
    }, 700_000);
  });
}
