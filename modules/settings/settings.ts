/**
 * v2 설정: 켜진 앱, 단축키 자리 배정, 앱별 설정값, 테마, 엔진 선택. 비밀값은 여기 두지 않는다(Keychain, 미정).
 * 파일 하나(<path>), 쓰기는 임시 파일 → fsync → rename(쓰다 꺼져도 옛 내용이나 새 내용 중 하나만 남는다).
 * 읽지 못하면 옆에 broken/ 사본을 두고 기본값으로 시작한다 — 조용히 덮어쓰지 않는다.
 */
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Assignments } from '../hotkey/slots.ts';

export interface SettingsData {
  schema: 1;
  /** 켜져 있어야 할 앱 id. 실행 서버가 다시 뜰 때 이 목록으로 복원한다 */
  enabled: string[];
  hotkeys: Assignments;
  /** 앱이 끈 뒤에도 기억하는 지난 자리(다시 켜면 같은 자리) */
  hotkeysPrevious: Assignments;
  /** 앱 id → key → 값(문자열로 보관, 스크립트에 env로 간다) */
  appSettings: Record<string, Record<string, string>>;
  theme: 'light' | 'dark' | 'system';
  engine: 'claude' | 'codex' | null;
  /** 유지보수 팀이 고친 수정본을 확인 없이 바로 적용한다(계획서 11.3). 켜도 적용 뒤 알림은 간다. 기본 꺼짐 */
  autoApplyFixes: boolean;
}

export const DEFAULT_SETTINGS: SettingsData = { schema: 1, enabled: [], hotkeys: {}, hotkeysPrevious: {}, appSettings: {}, theme: 'system', engine: null, autoApplyFixes: false };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strMap = (v: unknown): Record<string, string> =>
  isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string') as [string, string][]) : {};

/** 받은 JSON을 칸마다 따져 읽는다. 모르는 칸은 버리고 깨진 칸은 기본값 */
export const normalize = (raw: unknown): SettingsData => {
  if (!isObj(raw)) return { ...DEFAULT_SETTINGS };
  return {
    schema: 1,
    enabled: Array.isArray(raw.enabled) ? raw.enabled.filter((x): x is string => typeof x === 'string') : [],
    hotkeys: strMap(raw.hotkeys),
    hotkeysPrevious: strMap(raw.hotkeysPrevious),
    appSettings: isObj(raw.appSettings) ? Object.fromEntries(Object.entries(raw.appSettings).map(([id, v]) => [id, strMap(v)])) : {},
    theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
    engine: raw.engine === 'claude' || raw.engine === 'codex' ? raw.engine : null,
    autoApplyFixes: raw.autoApplyFixes === true,
  };
};

export class Settings {
  private data: SettingsData;
  /** 읽지 못해 사본을 둔 경로. 화면이 알려 줄 수 있게 */
  readonly brokenCopy: string | null = null;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      this.data = { ...DEFAULT_SETTINGS };
      return;
    }
    try {
      this.data = normalize(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      const brokenDir = join(dirname(path), 'broken');
      mkdirSync(brokenDir, { recursive: true });
      const copy = join(brokenDir, `${basename(path)}.${Date.now()}`);
      copyFileSync(path, copy);
      this.brokenCopy = copy;
      this.data = { ...DEFAULT_SETTINGS };
    }
  }

  get(): Readonly<SettingsData> { return this.data; }

  update(patch: Partial<Omit<SettingsData, 'schema'>>): void {
    this.data = { ...this.data, ...patch };
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n');
    const fd = openSync(tmp, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
  }
}
