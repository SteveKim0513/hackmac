/**
 * 검증 게이트(계획서 7.3·9.3·9.4). 에이전트의 "다 됐다"를 믿지 않고 HackMac 코드가 직접 본다.
 * 보관소에 들어가는 길은 이 게이트를 통과하는 것 하나뿐이다(modules/build/inbox.ts의 submit).
 *
 * 검사 순서:
 *   package      선언이 맞고 트리거 스크립트가 있다(보관소 readPackage와 같은 규칙)
 *   capabilities 필요한 능력이 이 HackMac에 있다
 *   files        심볼릭 링크 없음, 크기 상한, 의존 폴더 없음
 *   portability  내 홈 절대경로·외부 도구(brew·npm·python…)·sudo 없음
 *   declared     스크립트가 자동화하는 앱과 접속하는 주소가 선언(permissions)에 있다
 *   popup        osascript 다이얼로그(display dialog / choose from list)를 직접 그리지 않는다
 *   baseline     서비스 기준 중 코드가 볼 수 있는 것(docs/service-baseline.md): S2 선언한 설정을 스크립트가 읽고 읽는 설정은 선언돼 있다,
 *                S5 외부 접속·자동화가 있으면 실패 경로 시험(checks/E*-*.sh)이 있다, S7 스크립트마다 기록 줄(echo·log)이 있다
 *   syntax       zsh -n
 *   version      이미 설치된 앱이면 버전 번호가 올라갔다
 *   checks       빈 가짜 홈에 설치한 뒤 checks/*.sh를 기본 PATH만으로 실제로 돌린다(요구사항별)
 * 앞 단계가 실패해도 뒤 단계를 가능한 만큼 돌려 한 번에 다 알려 준다(에이전트가 고치는 횟수를 줄인다).
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { missingCapabilities, type AppManifest } from '../../shared/manifest.ts';
import { readPackage } from '../store/store.ts';

export interface GateCheck { id: string; label: string; ok: boolean; problems: string[] }
export interface CheckRun { file: string; requirement: string | null; ok: boolean; code: number | null; output: string; ms: number }
export interface GateReport {
  ok: boolean;
  checks: GateCheck[];
  runs: CheckRun[];
  /** 요구사항 id → 통과한 시험이 있나. 시험이 없는 요구사항은 false */
  requirements: Record<string, 'passed' | 'failed' | 'missing' | 'manual'>;
  manifest: AppManifest | null;
}

export interface GateOptions {
  capabilities: Record<string, number>;
  /** 이 맥 사용자의 진짜 홈. 이 경로가 스크립트에 박혀 있으면 이식성 위반 */
  realHome: string;
  /** 가짜 팝업(resources/bin/hackmac-popup-stub) */
  popupStub: string;
  /** 진행 기록의 요구사항. manual: 자동 시험이 불가능해 사용자 확인으로 넘기는 것 */
  requirements?: { id: string; manual: boolean }[];
  /** 같은 id가 이미 설치돼 있으면 그 선언 버전 */
  installedVersion?: string | null;
  shell?: string;
  checkTimeoutMs?: number;
  maxBytes?: number;
}

const MAX_BYTES = 5 * 1024 * 1024;
/** 사용자 맥에 있다고 믿을 수 없는 도구(9.3 규칙 4). 명령 자리에 올 때만 잡는다 */
const FOREIGN_TOOLS = ['brew', 'npm', 'npx', 'node', 'pip', 'pip3', 'python', 'python3', 'yarn', 'pnpm', 'bun', 'deno', 'cargo', 'gem', 'ruby', 'go', 'java', 'swift', 'swiftc', 'xcodebuild', 'git'];
const CMD_POS = String.raw`(?:^|[;&|(\`]|\$\(|\bthen\b|\bdo\b|\belse\b|\bexec\b)\s*`;
const FOREIGN_RE = new RegExp(`${CMD_POS}(?:sudo\\s+)?(${FOREIGN_TOOLS.join('|')})(?=\\s|$|;)`, 'm');
const SUDO_RE = new RegExp(`${CMD_POS}sudo\\s`, 'm');
const TELL_RE = /tell\s+application\s+(?:id\s+)?"([^"]+)"/gi;
const URL_RE = /https?:\/\/([a-z0-9.-]+)/gi;
const DIALOG_RE = /\b(display\s+dialog|choose\s+from\s+list|display\s+alert|choose\s+file)\b/i;
const USER_PATH_RE = /\/Users\/(?!Shared\b)[A-Za-z0-9._-]+/;
const REQ_FILE_RE = /^(R\d+)[-_.]/;
const ERR_FILE_RE = /^checks\/E\d*[-_.][^/]*\.sh$/;
const ENV_REF_RE = /HACKMAC_(SETTING|SECRET)_([A-Z0-9_]+)/g;
const LOG_LINE_RE = /(^|[\s;&|({`])(echo|print|printf|log)\s/;
const envKeyOf = (k: string) => k.toUpperCase().replace(/-/g, '_');

/** 주석 줄을 뺀 내용(셸 # 주석). 따옴표 안의 #까지는 따지지 않는다 — 놓치는 쪽이 아니라 덜 잡는 쪽으로 기운다 */
const codeLines = (text: string): { n: number; line: string }[] =>
  text.split('\n').map((line, i) => ({ n: i + 1, line })).filter(({ line }) => !/^\s*#/.test(line));

const walk = (dir: string, base = dir): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() && !d.isSymbolicLink() ? walk(p, base) : [relative(base, p)];
  });

const hostAllowed = (host: string, allowed: string[]): boolean =>
  allowed.some((a) => {
    const h = host.toLowerCase();
    const x = a.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return x.startsWith('*.') ? h === x.slice(2) || h.endsWith(x.slice(1)) : h === x;
  });

const run = (cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<{ code: number | null; out: string; ms: number }> =>
  new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const add = (b: Buffer) => { out = (out + b.toString()).slice(-4000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => {
      out += `\n(시간 초과 ${o.timeoutMs / 1000}초 — 끊음)`;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* 이미 끝남 */ }
    }, o.timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: e.message, ms: Date.now() - t0 }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, ms: Date.now() - t0 }); });
  });

export async function runGate(pkgDir: string, o: GateOptions): Promise<GateReport> {
  const checks: GateCheck[] = [];
  const add = (id: string, label: string, problems: string[]) => checks.push({ id, label, ok: problems.length === 0, problems });
  const shell = o.shell ?? '/bin/zsh';

  if (!existsSync(join(pkgDir, 'manifest.json'))) {
    add('package', '앱 선언', [`${pkgDir}/manifest.json이 없음`]);
    return { ok: false, checks, runs: [], requirements: {}, manifest: null };
  }

  const read = readPackage(pkgDir);
  add('package', '앱 선언', read.ok ? [] : read.errors);
  const m = read.ok ? read.manifest : null;

  if (m) {
    const missing = missingCapabilities(m, o.capabilities);
    add('capabilities', '필요한 능력', missing.map((x) => `능력 '${x.name}' ${x.need}가 이 HackMac에 없음(가진 것: ${x.have ?? '없음'})`));
  }

  // 파일: 링크·크기
  const files = walk(pkgDir);
  const fileProblems: string[] = [];
  let bytes = 0;
  for (const f of files) {
    const st = lstatSync(join(pkgDir, f));
    if (st.isSymbolicLink()) fileProblems.push(`${f}: 심볼릭 링크는 둘 수 없음(다른 맥에서 가리킬 곳이 없다)`);
    else bytes += st.size;
  }
  if (bytes > (o.maxBytes ?? MAX_BYTES)) fileProblems.push(`패키지가 너무 큼: ${(bytes / 1024 / 1024).toFixed(1)}MB(상한 ${((o.maxBytes ?? MAX_BYTES) / 1024 / 1024).toFixed(0)}MB)`);
  add('files', '파일', fileProblems);

  // 스크립트 내용 검사
  const scripts = files.filter((f) => /^(scripts|checks)\//.test(f) && !lstatSync(join(pkgDir, f)).isSymbolicLink());
  const port: string[] = [];
  const declared: string[] = [];
  const popup: string[] = [];
  const automation = new Set((m?.permissions.automation ?? []).map((a) => a.toLowerCase()));
  const network = m?.permissions.network ?? [];
  for (const f of scripts) {
    let text: string;
    try { text = readFileSync(join(pkgDir, f), 'utf8'); } catch { continue; }
    if (text.includes(o.realHome)) port.push(`${f}: 이 맥의 홈 경로(${o.realHome})가 박혀 있음 → $HOME이나 $HACKMAC_DATA_DIR을 쓴다`);
    for (const { n, line } of codeLines(text)) {
      if (USER_PATH_RE.test(line) && !line.includes(o.realHome)) port.push(`${f}:${n}: 사용자 절대경로 → $HOME이나 $HACKMAC_DATA_DIR을 쓴다`);
      const tool = FOREIGN_RE.exec(line)?.[1];
      if (tool) port.push(`${f}:${n}: '${tool}'는 다른 맥에 없을 수 있음 → macOS 기본 도구(zsh·osascript·curl·plutil 등)만 쓴다`);
      if (SUDO_RE.test(line)) port.push(`${f}:${n}: sudo는 쓸 수 없음`);
      if (DIALOG_RE.test(line)) popup.push(`${f}:${n}: osascript 다이얼로그 대신 "$HACKMAC_POPUP" select|prompt|confirm|date를 쓴다`);
      if (f.startsWith('checks/') && /\bosascript\b/.test(line)) port.push(`${f}:${n}: 시험 스크립트는 osascript로 실제 앱을 건드리지 않는다(사용자 데이터 보호). 앱 로직을 따로 떼어 시험한다`);
      for (const mm of line.matchAll(TELL_RE)) {
        if (!automation.has(mm[1].toLowerCase()) && f.startsWith('scripts/')) declared.push(`${f}:${n}: "${mm[1]}" 자동화를 permissions.automation에 적지 않음`);
      }
      for (const mm of line.matchAll(URL_RE)) {
        if (!hostAllowed(mm[1], network) && f.startsWith('scripts/')) declared.push(`${f}:${n}: ${mm[1]} 접속을 permissions.network에 적지 않음`);
      }
    }
  }
  add('portability', '다른 맥에서도 도는가', port);
  add('declared', '선언한 권한', [...new Set(declared)]);
  add('popup', '팝업 규칙', popup);

  // 서비스 기준(코드가 볼 수 있는 것)
  const baseline: string[] = [];
  if (m) {
    const appScripts = scripts.filter((f) => f.startsWith('scripts/'));
    const texts = appScripts.map((f) => { try { return { f, text: readFileSync(join(pkgDir, f), 'utf8') }; } catch { return { f, text: '' }; } });
    const used = { SETTING: new Set<string>(), SECRET: new Set<string>() };
    for (const { text } of texts) for (const mm of text.matchAll(ENV_REF_RE)) used[mm[1] as 'SETTING' | 'SECRET'].add(mm[2]);
    const byTrigger = new Set(m.triggers.flatMap((t) => (t.kind === 'schedule' ? [t.atSetting, t.everyMinutesSetting].filter((x): x is string => !!x) : [])));
    for (const d of m.settings) {
      if (!used.SETTING.has(envKeyOf(d.key)) && !byTrigger.has(d.key)) baseline.push(`S2: 설정 '${d.key}'(${d.label})을 읽는 스크립트가 없음 → 스크립트가 $HACKMAC_SETTING_${envKeyOf(d.key)}를 쓰거나, 쓰지 않는 설정이면 뺀다`);
    }
    for (const d of m.secrets) if (!used.SECRET.has(envKeyOf(d.key))) baseline.push(`S2: 비밀값 '${d.key}'(${d.label})을 읽는 스크립트가 없음`);
    const declaredSettings = new Set(m.settings.map((d) => envKeyOf(d.key)));
    const declaredSecrets = new Set(m.secrets.map((d) => envKeyOf(d.key)));
    for (const k of used.SETTING) if (!declaredSettings.has(k)) baseline.push(`S2: 스크립트가 $HACKMAC_SETTING_${k}를 읽지만 settings에 선언이 없음 → 선언해야 설정 화면에 나온다`);
    for (const k of used.SECRET) if (!declaredSecrets.has(k)) baseline.push(`S2: 스크립트가 $HACKMAC_SECRET_${k}를 읽지만 secrets에 선언이 없음`);
    if ((m.permissions.network.length > 0 || m.permissions.automation.length > 0) && !files.some((f) => ERR_FILE_RE.test(f))) {
      baseline.push('S5: 인터넷 접속이나 다른 앱 자동화가 있는데 실패 경로 시험이 없음 → checks/E1-<이름>.sh로 접속 실패·빈 결과일 때 앱이 알리는지 시험한다');
    }
    for (const { f, text } of texts) {
      if (!f.endsWith('.sh')) continue;
      if (!codeLines(text).some(({ line }) => LOG_LINE_RE.test(line))) baseline.push(`S7: ${f}에 기록 줄이 없음 → 판단 지점마다 echo(AppleScript는 log)로 남긴다`);
    }
  }
  add('baseline', '서비스 기준', baseline);

  // 문법
  const syntax: string[] = [];
  for (const f of scripts.filter((s) => s.endsWith('.sh'))) {
    const r = await run(shell, ['-n', join(pkgDir, f)], { cwd: pkgDir, env: { PATH: '/usr/bin:/bin' }, timeoutMs: 10_000 });
    if (r.code !== 0) syntax.push(`${f}: ${r.out.trim().split('\n').slice(0, 3).join(' / ')}`);
  }
  add('syntax', '셸 문법', syntax);

  if (m && o.installedVersion != null) {
    const a = Number(m.version);
    const b = Number(o.installedVersion);
    add('version', '버전', Number.isInteger(a) && Number.isInteger(b) && a > b ? [] : [`설치된 버전이 ${o.installedVersion}이라 version을 ${Number.isInteger(b) ? b + 1 : '더 큰 수'} 이상으로 올려야 함(지금 ${m.version})`]);
  }

  // 시험: 빈 가짜 홈에 설치해서 돌린다
  const runs: CheckRun[] = [];
  const checkFiles = files.filter((f) => /^checks\/[^/]+\.sh$/.test(f)).sort();
  const sandbox = mkdtempSync(join(tmpdir(), 'hackmac-gate-'));
  try {
    const home = join(sandbox, 'home');
    const appDir = join(sandbox, 'app');
    mkdirSync(home, { recursive: true });
    cpSync(pkgDir, appDir, { recursive: true, dereference: false });
    for (const f of checkFiles) {
      const dataDir = join(sandbox, 'data', f.replace(/\W/g, '_'));
      mkdirSync(dataDir, { recursive: true });
      const settingsEnv = Object.fromEntries((m?.settings ?? []).filter((d) => d.default !== undefined).map((d) => [`HACKMAC_SETTING_${d.key.toUpperCase().replace(/-/g, '_')}`, typeof d.default === 'string' ? d.default : JSON.stringify(d.default)]));
      const env: Record<string, string> = {
        HOME: home,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'ko_KR.UTF-8',
        TMPDIR: join(sandbox, 'tmp'),
        HACKMAC_APP_DIR: appDir,
        HACKMAC_DATA_DIR: dataDir,
        HACKMAC_POPUP: o.popupStub,
        HACKMAC_CHECK: '1',
        ...settingsEnv,
      };
      mkdirSync(env.TMPDIR, { recursive: true });
      const r = await run(shell, [join(appDir, f)], { cwd: dataDir, env, timeoutMs: o.checkTimeoutMs ?? 60_000 });
      runs.push({ file: f, requirement: REQ_FILE_RE.exec(f.slice('checks/'.length))?.[1] ?? null, ok: r.code === 0, code: r.code, output: r.out.trim(), ms: r.ms });
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  const failedRuns = runs.filter((r) => !r.ok);
  const requirements: GateReport['requirements'] = {};
  for (const req of o.requirements ?? []) {
    const mine = runs.filter((r) => r.requirement === req.id);
    requirements[req.id] = req.manual ? 'manual' : mine.length === 0 ? 'missing' : mine.every((r) => r.ok) ? 'passed' : 'failed';
  }
  const missingReq = Object.entries(requirements).filter(([, s]) => s === 'missing').map(([id]) => id);
  add('checks', '시험', [
    ...failedRuns.map((r) => `${r.file}: 실패(코드 ${r.code}) — ${r.output.split('\n').slice(-3).join(' / ')}`),
    ...missingReq.map((id) => `${id}: 시험이 없음 → checks/${id}-<이름>.sh를 만든다(자동으로 확인할 수 없으면 manual로 표시)`),
    // 모든 요구사항을 manual로 표시해 시험을 통째로 피하지 못하게: 직접 확인 요구사항도 판단 부분 시험은 있어야 한다
    ...(checkFiles.length === 0 ? ['checks/*.sh가 하나도 없음 — 직접 확인(manual) 요구사항도 판단·가공 부분은 시험한다'] : []),
  ]);

  return { ok: checks.every((c) => c.ok), checks, runs, requirements, manifest: m };
}

/** 에이전트에게 돌려줄 짧은 글(한 화면). 실패만 자세히 */
export const formatReport = (r: GateReport): string => {
  const lines = [r.ok ? '검증 통과' : '검증 실패'];
  for (const c of r.checks) {
    lines.push(`${c.ok ? '✓' : '✗'} ${c.label}`);
    for (const p of c.problems.slice(0, 10)) lines.push(`    - ${p}`);
    if (c.problems.length > 10) lines.push(`    … 외 ${c.problems.length - 10}건`);
  }
  if (r.runs.length) lines.push(`시험 ${r.runs.filter((x) => x.ok).length}/${r.runs.length} 통과`);
  return lines.join('\n');
};
