import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatReport, runGate, type GateOptions } from './gate.ts';

const STUB = join(process.cwd(), 'resources', 'bin', 'hackmac-popup-stub');
let tmp: string;
let pkg: string;

const manifest = (over: Record<string, unknown> = {}) => ({
  schema: 1, id: 'my.greet', version: '1', author: { name: 'me', signature: null }, hackmac: { min: '2.0.0' },
  name: '인사', icon: '👋', tagline: '{hotkey:hi} 누르면 인사', usage: ['{hotkey:hi}를 누른다'],
  triggers: [{ kind: 'hotkey', script: 'scripts/hi.sh', key: 'hi', name: '인사하기', description: '이름을 묻고 인사를 남긴다' }],
  capabilities: { popup: '>=1' }, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false },
  settings: [{ key: 'greeting', label: '인사말', type: 'string', default: '안녕' }], secrets: [], references: [], ...over,
});

const write = (rel: string, body: string) => {
  const p = join(pkg, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body);
};

/** 잘 만든 앱: 팝업으로 이름을 받아 데이터 폴더에 인사를 남긴다. 시험은 가짜 팝업으로 그 결과를 본다 */
const goodApp = () => {
  write('manifest.json', JSON.stringify(manifest()));
  write('scripts/hi.sh', '#!/bin/zsh\nname=$("$HACKMAC_POPUP" prompt --title 인사 --prompt 이름 --ok 확인 --cancel 취소 --default 친구) || exit 0\necho "판단: 이름=$name"\nprint -r -- "$HACKMAC_SETTING_GREETING, $name" > "$HACKMAC_DATA_DIR/last.txt"\n');
  write('checks/R1-greets.sh', '#!/bin/zsh\nset -e\nHACKMAC_STUB_PROMPT=지호 zsh "$HACKMAC_APP_DIR/scripts/hi.sh"\n[[ "$(cat "$HACKMAC_DATA_DIR/last.txt")" == "안녕, 지호" ]]\n');
  write('checks/R2-cancel.sh', '#!/bin/zsh\nHACKMAC_STUB_CANCEL=1 zsh "$HACKMAC_APP_DIR/scripts/hi.sh" || exit 1\n[[ ! -e "$HACKMAC_DATA_DIR/last.txt" ]]\n');
};

const opts = (over: Partial<GateOptions> = {}): GateOptions => ({
  capabilities: { popup: 1 }, realHome: homedir(), popupStub: STUB,
  requirements: [{ id: 'R1', manual: false }, { id: 'R2', manual: false }], ...over,
});
const failed = (r: Awaited<ReturnType<typeof runGate>>) => r.checks.filter((c) => !c.ok).map((c) => c.id);

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-gatet-'));
  pkg = join(tmp, 'app');
  mkdirSync(pkg);
  chmodSync(STUB, 0o755);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('runGate', () => {
  it('잘 만든 앱은 통과하고, 요구사항마다 시험 결과가 붙는다', async () => {
    goodApp();
    const r = await runGate(pkg, opts());
    expect(failed(r), formatReport(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.requirements).toEqual({ R1: 'passed', R2: 'passed' });
    expect(r.runs.map((x) => [x.file, x.requirement, x.ok])).toEqual([['checks/R1-greets.sh', 'R1', true], ['checks/R2-cancel.sh', 'R2', true]]);
    expect(r.runs[0].output).toContain('hackmac-popup-stub: prompt');
  });

  it('선언이 없거나 깨졌으면 package에서 걸린다', async () => {
    expect(failed(await runGate(pkg, opts()))).toEqual(['package']);
    goodApp();
    write('manifest.json', JSON.stringify(manifest({ tagline: 'Alt+1 누르면' })));
    expect(failed(await runGate(pkg, opts()))).toContain('package');
  });

  it('없는 능력을 요구하면 capabilities', async () => {
    goodApp();
    write('manifest.json', JSON.stringify(manifest({ capabilities: { popup: '>=1', ocr: '>=1' } })));
    const r = await runGate(pkg, opts());
    expect(failed(r)).toEqual(['capabilities']);
    expect(r.checks.find((c) => c.id === 'capabilities')!.problems[0]).toContain("'ocr'");
  });

  it('내 홈 절대경로·외부 도구·sudo는 portability', async () => {
    goodApp();
    write('scripts/extra.sh', `#!/bin/zsh\n# 주석의 brew install은 괜찮다\ncat ${homedir()}/notes.txt\nbrew install jq\nx=$(python3 -c 1)\nsudo rm -rf /tmp/x\ncat /Users/someone/a\nls /Users/Shared\n`);
    const r = await runGate(pkg, opts());
    expect(failed(r)).toEqual(['portability']);
    const p = r.checks.find((c) => c.id === 'portability')!.problems.join('\n');
    expect(p).toContain('홈 경로');
    expect(p).toContain("'brew'");
    expect(p).toContain("'python3'");
    expect(p).toContain('sudo');
    expect(p).toContain('extra.sh:7: 사용자 절대경로');
    expect(p).not.toContain(':2:');
    expect(p).not.toContain(':8:');
  });

  it('선언 안 한 자동화·주소는 declared, 와일드카드는 허용', async () => {
    goodApp();
    write('manifest.json', JSON.stringify(manifest({ permissions: { network: ['*.example.com'], automation: ['Calendar'], accessibility: false, fullDiskAccess: false } })));
    write('scripts/x.sh', '#!/bin/zsh\nosascript -e \'tell application "Calendar" to get name\'\nosascript -e \'tell application "Reminders" to get name\'\ncurl -s https://api.example.com/q\ncurl -s https://evil.test/q\n');
    const r = await runGate(pkg, opts());
    expect(failed(r)).toEqual(['declared']);
    expect(r.checks.find((c) => c.id === 'declared')!.problems).toEqual(['scripts/x.sh:3: "Reminders" 자동화를 permissions.automation에 적지 않음', 'scripts/x.sh:5: evil.test 접속을 permissions.network에 적지 않음']);
  });

  it('osascript 다이얼로그는 popup, 시험에서 osascript는 portability', async () => {
    goodApp();
    write('scripts/d.sh', '#!/bin/zsh\nosascript -e \'display dialog "hi"\'\nosascript -e \'display notification "ok"\'\n');
    write('checks/R1-x.sh', '#!/bin/zsh\nosascript -e \'return 1\'\n');
    const r = await runGate(pkg, opts());
    expect(failed(r)).toEqual(expect.arrayContaining(['popup', 'portability']));
    expect(r.checks.find((c) => c.id === 'popup')!.problems).toEqual(['scripts/d.sh:2: osascript 다이얼로그 대신 "$HACKMAC_POPUP" select|prompt|confirm|date를 쓴다']);
  });

  it('문법 오류는 syntax', async () => {
    goodApp();
    write('scripts/bad.sh', '#!/bin/zsh\nif [[ 1 ]]; then\necho x\n');
    expect(failed(await runGate(pkg, opts()))).toEqual(['syntax']);
  });

  it('설치된 버전보다 크지 않으면 version', async () => {
    goodApp();
    expect(failed(await runGate(pkg, opts({ installedVersion: '1' })))).toEqual(['version']);
    expect(failed(await runGate(pkg, opts({ installedVersion: '0' })))).toEqual([]);
  });

  it('시험 실패·시험 없는 요구사항은 checks, manual은 시험 없이 넘어간다', async () => {
    goodApp();
    write('checks/R2-cancel.sh', '#!/bin/zsh\necho 왜 실패하는지 >&2\nexit 3\n');
    const r = await runGate(pkg, opts({ requirements: [{ id: 'R1', manual: false }, { id: 'R2', manual: false }, { id: 'R3', manual: false }, { id: 'R4', manual: true }] }));
    expect(failed(r)).toEqual(['checks']);
    expect(r.requirements).toEqual({ R1: 'passed', R2: 'failed', R3: 'missing', R4: 'manual' });
    const p = r.checks.find((c) => c.id === 'checks')!.problems.join('\n');
    expect(p).toContain('왜 실패하는지');
    expect(p).toContain('R3: 시험이 없음');
  });

  it('시험은 기본 PATH와 빈 가짜 홈에서 돈다(내 맥의 도구·파일에 기대면 실패)', async () => {
    goodApp();
    write('checks/R1-env.sh', `#!/bin/zsh\n[[ "$PATH" == "/usr/bin:/bin:/usr/sbin:/sbin" ]] || exit 1\n[[ "$HOME" != "${homedir()}" ]] || exit 2\n[[ -z "$(ls -A "$HOME")" ]] || exit 3\n[[ "$HACKMAC_CHECK" == 1 ]] || exit 4\n`);
    const r = await runGate(pkg, opts({ realHome: '/nonexistent-home' }));
    expect(r.runs.find((x) => x.file === 'checks/R1-env.sh')).toMatchObject({ ok: true });
  });

  it('멈춘 시험은 시간 초과로 끊는다', async () => {
    goodApp();
    write('checks/R1-hang.sh', '#!/bin/zsh\nsleep 30\n');
    const r = await runGate(pkg, opts({ checkTimeoutMs: 500 }));
    expect(r.runs.find((x) => x.file === 'checks/R1-hang.sh')).toMatchObject({ ok: false, output: expect.stringContaining('시간 초과') });
  });

  it('심볼릭 링크는 files', async () => {
    goodApp();
    symlinkSync('/etc/hosts', join(pkg, 'scripts', 'link'));
    expect(failed(await runGate(pkg, opts()))).toEqual(['files']);
  });
});
