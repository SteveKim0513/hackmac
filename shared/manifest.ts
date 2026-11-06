/**
 * v2 앱 선언(manifest.json)의 타입과 구조 검증. docs/hackmac-v2-manifest.md가 사람이 읽는 원본이고,
 * 이 파일이 기계가 읽는 원본이다. 둘이 어긋나면 이 파일을 고치고 문서를 맞춘다.
 *
 * 여기서는 파일 시스템을 보지 않는다(스크립트 존재·내용 검사는 보관소/검증 게이트의 몫).
 * 받은 JSON이 신뢰 경계를 넘어온 것(남이 보낸 앱 파일)이므로 모든 칸을 따져 읽는다.
 */

export const MANIFEST_SCHEMA = 1;

export type HotkeyTrigger = { kind: 'hotkey'; script: string; key: string; name: string; description: string };
export type ResidentTrigger = { kind: 'resident'; script: string; heartbeat: number };
/**
 * 정해진 때 1회 실행. 때는 넷 중 하나로 정한다:
 *   cron / every          선언에 박아 둔 때(사용자가 못 바꾼다)
 *   atSetting             `time` 종류 설정의 키 — 매일 그 시각(사용자가 설정 화면에서 바꾼다)
 *   everyMinutesSetting   `number` 종류 설정의 키 — 그 분마다(사용자가 바꾼다)
 */
export type ScheduleTrigger = { kind: 'schedule'; script: string; name: string; cron?: string; every?: number; atSetting?: string; everyMinutesSetting?: string };
export type LoginTrigger = { kind: 'login'; script: string; name: string };
export type EventTrigger = { kind: 'event'; script: string; on: string };
export type Trigger = HotkeyTrigger | ResidentTrigger | ScheduleTrigger | LoginTrigger | EventTrigger;

/** time: 24시간 "HH:MM" */
export type SettingType = 'string' | 'number' | 'boolean' | 'list' | 'choice' | 'time';
export interface SettingDecl {
  key: string;
  label: string;
  type: SettingType;
  default?: unknown;
  required?: boolean;
  options?: string[];
}
export interface SecretDecl { key: string; label: string; required?: boolean }

export interface Permissions {
  network: string[];
  automation: string[];
  accessibility: boolean;
  fullDiskAccess: boolean;
}

export interface Reference {
  repo: string;
  commit: string;
  path?: string;
  borrowed: string;
  license: string;
}

export interface AppManifest {
  schema: number;
  id: string;
  version: string;
  author: { name: string; signature: string | null };
  hackmac: { min: string };
  name: string;
  icon: string;
  tagline: string;
  usage: string[];
  accentColor?: string;
  whatItIs?: string[];
  differentiators?: string[];
  strengths?: string[];
  triggers: Trigger[];
  /** 능력 이름 → 버전 범위(지금은 `>=N`만) */
  capabilities: Record<string, string>;
  permissions: Permissions;
  settings: SettingDecl[];
  secrets: SecretDecl[];
  references: Reference[];
}

export type ManifestResult = { ok: true; manifest: AppManifest } | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const KEY_RE = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_RE = /^[1-9][0-9]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CAP_RANGE_RE = /^>=([1-9][0-9]*)$/;
/** 카피에 키 조합을 직접 쓰면 안 된다(자리 배정이라 받는 사람 맥에서 다르다). `{hotkey:<key>}`만 허용 */
const LITERAL_HOTKEY_RE = /\b(Alt|Option|Opt|Cmd|Command|Ctrl|Control|Shift)\s*\+/i;
const CRON_RE = /^(\S+\s+){4}\S+$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** 패키지 밖을 가리키는 경로 금지. 루트 기준 상대경로만 */
export const isPackagePath = (p: unknown): p is string =>
  isStr(p) && !p.startsWith('/') && !p.startsWith('~') && !p.split('/').includes('..') && !p.includes('\\');

const checkCopy = (errors: string[], field: string, v: unknown, required: boolean): void => {
  if (v === undefined) {
    if (required) errors.push(`${field}: 필수`);
    return;
  }
  if (!isStrArr(v)) return void errors.push(`${field}: 문자열 배열이어야 함`);
  for (const [i, s] of v.entries()) if (LITERAL_HOTKEY_RE.test(s)) errors.push(`${field}[${i}]: 키 조합을 직접 쓰지 말고 {hotkey:<key>}를 쓸 것`);
};

const checkTrigger = (errors: string[], i: number, t: unknown, hotkeyKeys: Set<string>, state: { resident: number }): void => {
  const at = `triggers[${i}]`;
  if (!isObj(t)) return void errors.push(`${at}: 객체여야 함`);
  if (!isPackagePath(t.script)) errors.push(`${at}.script: 패키지 안 상대경로여야 함`);
  switch (t.kind) {
    case 'hotkey':
      if (!isStr(t.key) || !KEY_RE.test(t.key)) errors.push(`${at}.key: 소문자·숫자·'-'`);
      else if (hotkeyKeys.has(t.key)) errors.push(`${at}.key: '${t.key}' 중복`);
      else hotkeyKeys.add(t.key);
      if (!isStr(t.name)) errors.push(`${at}.name: 필수`);
      if (!isStr(t.description)) errors.push(`${at}.description: 필수`);
      if ('hotkey' in t) errors.push(`${at}.hotkey: 키 조합은 선언에 적지 않는다(HackMac이 자리를 배정)`);
      return;
    case 'resident':
      if (!isPosInt(t.heartbeat)) errors.push(`${at}.heartbeat: 양의 정수(초)`);
      if (++state.resident > 1) errors.push(`${at}: resident는 앱당 하나`);
      return;
    case 'schedule': {
      if (!isStr(t.name)) errors.push(`${at}.name: 필수`);
      const hasCron = t.cron !== undefined;
      const hasEvery = t.every !== undefined;
      const hasAt = t.atSetting !== undefined;
      const hasEveryMin = t.everyMinutesSetting !== undefined;
      if ([hasCron, hasEvery, hasAt, hasEveryMin].filter(Boolean).length !== 1) errors.push(`${at}: cron·every·atSetting·everyMinutesSetting 중 하나만`);
      if (hasAt && (!isStr(t.atSetting) || !KEY_RE.test(t.atSetting))) errors.push(`${at}.atSetting: 설정 키`);
      if (hasEveryMin && (!isStr(t.everyMinutesSetting) || !KEY_RE.test(t.everyMinutesSetting))) errors.push(`${at}.everyMinutesSetting: 설정 키`);
      if (hasCron && (!isStr(t.cron) || !CRON_RE.test(t.cron))) errors.push(`${at}.cron: 5칸`);
      if (hasEvery && !isPosInt(t.every)) errors.push(`${at}.every: 양의 정수(초)`);
      return;
    }
    case 'login':
      if (!isStr(t.name)) errors.push(`${at}.name: 필수`);
      return;
    case 'event':
      if (!isStr(t.on)) errors.push(`${at}.on: 필수`);
      return;
    default:
      errors.push(`${at}.kind: 모르는 종류 '${String(t.kind)}'`);
  }
};

const checkSettings = (errors: string[], v: unknown): void => {
  if (!Array.isArray(v)) return void errors.push('settings: 배열이어야 함');
  const keys = new Set<string>();
  v.forEach((s, i) => {
    const at = `settings[${i}]`;
    if (!isObj(s)) return void errors.push(`${at}: 객체여야 함`);
    if (!isStr(s.key) || !KEY_RE.test(s.key)) errors.push(`${at}.key: 소문자·숫자·'-'`);
    else if (keys.has(s.key)) errors.push(`${at}.key: '${s.key}' 중복`);
    else keys.add(s.key);
    if (!isStr(s.label)) errors.push(`${at}.label: 필수`);
    if (!['string', 'number', 'boolean', 'list', 'choice', 'time'].includes(s.type as string)) errors.push(`${at}.type: string|number|boolean|list|choice|time`);
    if (s.type === 'choice' && !isStrArr(s.options)) errors.push(`${at}.options: choice면 필수`);
    if (s.required !== undefined && typeof s.required !== 'boolean') errors.push(`${at}.required: boolean`);
  });
};

const checkSecrets = (errors: string[], v: unknown): void => {
  if (!Array.isArray(v)) return void errors.push('secrets: 배열이어야 함');
  const keys = new Set<string>();
  v.forEach((s, i) => {
    const at = `secrets[${i}]`;
    if (!isObj(s)) return void errors.push(`${at}: 객체여야 함`);
    if (!isStr(s.key) || !KEY_RE.test(s.key)) errors.push(`${at}.key: 소문자·숫자·'-'`);
    else if (keys.has(s.key)) errors.push(`${at}.key: '${s.key}' 중복`);
    else keys.add(s.key);
    if (!isStr(s.label)) errors.push(`${at}.label: 필수`);
    if (s.required !== undefined && typeof s.required !== 'boolean') errors.push(`${at}.required: boolean`);
  });
};

/** 구조 검증(문서 4절의 1·2·9와 3의 경로 꼴). 파일 시스템은 보지 않는다 */
export const parseManifest = (raw: unknown): ManifestResult => {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['manifest: 객체여야 함'] };
  const m = raw;

  if (m.schema !== MANIFEST_SCHEMA) errors.push(`schema: ${MANIFEST_SCHEMA}만 읽을 수 있음 (받은 값 ${String(m.schema)})`);
  if (!isStr(m.id) || !ID_RE.test(m.id)) errors.push("id: '<작성자>.<이름>' (소문자·숫자·'-')");
  if (!isStr(m.version) || !VERSION_RE.test(m.version)) errors.push('version: 1 이상의 정수 문자열');
  if (!isObj(m.author) || !isStr(m.author.name)) errors.push('author.name: 필수');
  else if (m.author.signature !== null && m.author.signature !== undefined && !isStr(m.author.signature)) errors.push('author.signature: 문자열 또는 null');
  if (!isObj(m.hackmac) || !isStr(m.hackmac.min) || !SEMVER_RE.test(m.hackmac.min)) errors.push('hackmac.min: x.y.z');

  if (!isStr(m.name)) errors.push('name: 필수');
  if (!isStr(m.icon)) errors.push('icon: 필수');
  if (!isStr(m.tagline)) errors.push('tagline: 필수');
  else if (LITERAL_HOTKEY_RE.test(m.tagline)) errors.push('tagline: 키 조합을 직접 쓰지 말 것');
  checkCopy(errors, 'usage', m.usage, true);
  checkCopy(errors, 'whatItIs', m.whatItIs, false);
  checkCopy(errors, 'differentiators', m.differentiators, false);
  checkCopy(errors, 'strengths', m.strengths, false);
  if (m.accentColor !== undefined && (!isStr(m.accentColor) || !/^#[0-9a-fA-F]{6}$/.test(m.accentColor))) errors.push('accentColor: #rrggbb');

  if (!Array.isArray(m.triggers) || m.triggers.length === 0) errors.push('triggers: 하나 이상');
  else {
    const hotkeyKeys = new Set<string>();
    const state = { resident: 0 };
    m.triggers.forEach((t, i) => checkTrigger(errors, i, t, hotkeyKeys, state));
  }

  if (!isObj(m.capabilities)) errors.push('capabilities: 객체여야 함');
  else for (const [name, range] of Object.entries(m.capabilities)) {
    if (!KEY_RE.test(name)) errors.push(`capabilities.${name}: 이름은 소문자·숫자·'-'`);
    if (!isStr(range) || !CAP_RANGE_RE.test(range)) errors.push(`capabilities.${name}: 버전 범위는 '>=N'`);
  }

  if (!isObj(m.permissions)) errors.push('permissions: 객체여야 함');
  else {
    const p = m.permissions;
    if (!Array.isArray(p.network) || !p.network.every(isStr)) errors.push('permissions.network: 문자열 배열');
    if (!Array.isArray(p.automation) || !p.automation.every(isStr)) errors.push('permissions.automation: 문자열 배열');
    if (typeof p.accessibility !== 'boolean') errors.push('permissions.accessibility: boolean');
    if (typeof p.fullDiskAccess !== 'boolean') errors.push('permissions.fullDiskAccess: boolean');
  }

  checkSettings(errors, m.settings);
  checkSecrets(errors, m.secrets);
  // 스케줄이 가리키는 설정이 있고 종류가 맞아야 한다
  if (Array.isArray(m.triggers) && Array.isArray(m.settings)) {
    const decls = new Map((m.settings as unknown[]).filter(isObj).map((d) => [String(d.key), d]));
    m.triggers.forEach((t, i) => {
      if (!isObj(t) || t.kind !== 'schedule') return;
      for (const [field, want] of [['atSetting', 'time'], ['everyMinutesSetting', 'number']] as const) {
        const key = t[field];
        if (key === undefined) continue;
        const d = decls.get(String(key));
        if (!d) errors.push(`triggers[${i}].${field}: 설정 '${String(key)}'가 settings에 없음`);
        else if (d.type !== want) errors.push(`triggers[${i}].${field}: 설정 '${String(key)}'는 ${want} 종류여야 함(지금 ${String(d.type)})`);
      }
    });
  }

  if (!Array.isArray(m.references)) errors.push('references: 배열이어야 함');
  else m.references.forEach((r, i) => {
    const at = `references[${i}]`;
    if (!isObj(r)) return void errors.push(`${at}: 객체여야 함`);
    for (const f of ['repo', 'commit', 'borrowed', 'license'] as const) if (!isStr(r[f])) errors.push(`${at}.${f}: 필수`);
    if (r.path !== undefined && !isStr(r.path)) errors.push(`${at}.path: 문자열`);
  });

  return errors.length ? { ok: false, errors } : { ok: true, manifest: m as unknown as AppManifest };
};

/** 설치된 능력(이름 → 버전)과 견줘 부족한 것. 비어 있으면 설치 가능 (문서 4절의 4) */
export const missingCapabilities = (m: AppManifest, installed: Record<string, number>): { name: string; need: string; have: number | null }[] => {
  const out: { name: string; need: string; have: number | null }[] = [];
  for (const [name, range] of Object.entries(m.capabilities)) {
    const need = Number(CAP_RANGE_RE.exec(range)![1]);
    const have = installed[name];
    if (have === undefined || have < need) out.push({ name, need: range, have: have ?? null });
  }
  return out;
};

/** `x.y.z` 비교. a < b 면 음수 (문서 4절의 5) */
export const compareSemver = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
