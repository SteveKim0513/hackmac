/**
 * 실패 분류(계획서 11.2). **에이전트를 부르기 전에 코드가 먼저** 원인을 가른다.
 *   permission  macOS 권한이 꺼져 있다 → 안내 팝업만("설정 열기")
 *   network     인터넷이 끊겼다 → 안내만
 *   external    상대 서비스가 안 된다(5xx·한도) → 안내만
 *   code        스크립트 자체가 틀렸다(문법·없는 명령·못 찾는 대상) → 유지보수 팀을 부를 수 있다
 *   unknown     위에 없다 → 같은 실패가 반복될 때만 팀을 부른다
 * 사용자 한도를 헛되이 쓰지 않으려는 것이다: 외부 원인은 코드를 고쳐도 낫지 않는다.
 * 순서가 중요하다: AppleScript의 권한 거부도 "execution error"로 나오므로 권한을 먼저 본다.
 */
export type Cause = 'permission' | 'network' | 'external' | 'code' | 'unknown';

export interface Advice {
  title: string;
  body: string;
  /** 누르면 열 곳(시스템 설정 등). 없으면 알리기만 */
  action?: { label: string; url: string };
}

export interface Diagnosis {
  cause: Cause;
  /** 같은 문제인지 가리는 값(원인 + 첫 근거 줄에서 숫자·경로를 뺀 것) */
  signature: string;
  /** 쉬운 말 한 줄 */
  summary: string;
  /** 근거가 된 로그 줄(자세히에서 보인다) */
  evidence: string;
  advice: Advice | null;
}

export interface FailureInput {
  code: number | null;
  signal: string | null;
  log: string;
  appName: string;
}

const PANE = (name: string): string => `x-apple.systempreferences:com.apple.preference.security?${name}`;

interface Rule { cause: Cause; re: RegExp; summary: (m: RegExpExecArray, app: string) => string; advice?: (m: RegExpExecArray, app: string) => Advice }

const RULES: Rule[] = [
  {
    cause: 'permission',
    re: /Not authorized to send Apple events to ([^.\n(]+?)\.?(?:\s*\(|$)|\(-1743\)/im,
    summary: (m) => `${m[1]?.trim() || '다른 앱'} 조작 권한이 꺼져 있어요`,
    advice: (m, app) => ({
      title: `${app}에 권한이 필요해요`,
      body: `${m[1]?.trim() || '다른 앱'}을(를) 조작하려면 시스템 설정의 자동화에서 HackMac을 허용해 주세요.`,
      action: { label: '설정 열기', url: PANE('Privacy_Automation') },
    }),
  },
  {
    cause: 'permission',
    re: /not allowed assistive access|\(-1719\)|\(-25211\)|osascript is not allowed to send keystrokes/i,
    summary: () => '손쉬운 사용 권한이 꺼져 있어요',
    advice: (_m, app) => ({
      title: `${app}에 권한이 필요해요`,
      body: '키 입력을 대신 누르려면 시스템 설정의 손쉬운 사용에서 HackMac을 허용해 주세요.',
      action: { label: '설정 열기', url: PANE('Privacy_Accessibility') },
    }),
  },
  {
    cause: 'permission',
    re: /Operation not permitted|not permitted to (?:read|access)/i,
    summary: () => '파일을 읽을 권한이 없어요',
    advice: (_m, app) => ({
      title: `${app}에 권한이 필요해요`,
      body: '이 앱이 읽으려는 파일은 시스템 설정의 전체 디스크 접근에서 HackMac을 허용해야 열 수 있어요.',
      action: { label: '설정 열기', url: PANE('Privacy_AllFiles') },
    }),
  },
  {
    cause: 'network',
    re: /Could not resolve host|curl: \((?:6|7|28|35|52|56)\)|Network is unreachable|Connection refused|The Internet connection appears to be offline|ENOTFOUND|No route to host|Operation timed out/i,
    summary: () => '인터넷에 연결되지 않았어요',
    advice: (_m, app) => ({ title: `${app}이(가) 인터넷에 연결하지 못했어요`, body: '인터넷 연결을 확인해 주세요. 연결되면 다음 실행부터 다시 돼요.' }),
  },
  {
    cause: 'external',
    re: /HTTP\/[\d.]+ 5\d\d|returned error: 5\d\d|curl: \(22\)[^\n]*5\d\d|\b429 Too Many Requests|rate limit/i,
    summary: () => '상대 서비스가 지금 응답하지 않아요',
    advice: (_m, app) => ({ title: `${app}이(가) 쓰는 서비스가 응답하지 않아요`, body: '상대 서비스가 잠시 안 되는 것 같아요. 조금 뒤 다시 실행해 보세요. 앱을 고쳐도 낫지 않아요.' }),
  },
  {
    cause: 'code',
    re: /syntax error|parse error|command not found|: not found|unbound variable|bad substitution|no such file or directory|unexpected token|AppleScript[^\n]*(?:error|오류)|execution error|Can[’']?t get|doesn[’']?t understand|\(-1728\)|\(-2740\)|\(-2753\)/i,
    summary: () => '앱의 스크립트가 중간에 멈췄어요',
  },
];

/** 로그에서 근거 줄: 규칙에 걸린 줄(없으면 마지막 의미 있는 줄) */
const lineOf = (log: string, m: RegExpExecArray | null): string => {
  const lines = log.split('\n').map((l) => l.replace(/^\[[^\]]*\]\s*/, '').trim()).filter(Boolean);
  if (m) {
    const hit = lines.find((l) => new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(l));
    if (hit) return hit.slice(0, 300);
  }
  return (lines.at(-1) ?? '').slice(0, 300);
};

const normalize = (s: string): string => s.toLowerCase().replace(/\/[^\s:'"]+/g, '<path>').replace(/\d+/g, '#').replace(/\s+/g, ' ').slice(0, 120);

/** 실패한 실행 하나를 진단한다. 성공(코드 0)이면 null */
export const classify = (f: FailureInput): Diagnosis | null => {
  if (f.code === 0 && f.signal === null) return null;
  for (const r of RULES) {
    const m = r.re.exec(f.log);
    if (!m) continue;
    const evidence = lineOf(f.log, m);
    return { cause: r.cause, signature: `${r.cause}:${normalize(evidence)}`, summary: r.summary(m, f.appName), evidence, advice: r.advice ? r.advice(m, f.appName) : null };
  }
  const evidence = lineOf(f.log, null);
  const how = f.signal ? `중간에 끊겼어요(${f.signal})` : `오류로 끝났어요(코드 ${f.code})`;
  return { cause: 'unknown', signature: `unknown:${f.signal ?? f.code}:${normalize(evidence)}`, summary: `앱이 ${how}`, evidence, advice: null };
};
