import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { appLog, describeError } from './log';
import type { ThemePreference } from '../shared/types';

export interface AppSettings {
  /** Service ids the user has turned on — restored on next launch so
   * hotkeys keep working without the app needing to stay in the foreground. */
  activeServiceIds: string[];
  /** 사용자가 고른 라이트/다크/시스템 설정 — restored on next launch so the
   * window doesn't flash back to "시스템" before the user's choice loads. */
  themePreference: ThemePreference;
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeServiceIds: [],
  themePreference: 'system',
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (err) {
    // 파일이 아직 없는 최초 실행은 정상 케이스라 흔하지만, 있는데 파싱이
    // 깨진 경우(예: 비정상 종료 중 쓰기 도중 잘림)는 "서비스가 켜져
    // 있었는데 재시작하니 다 꺼져 있다" 문의의 원인이 될 수 있어 남긴다.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      appLog.error('settings', `설정 로드 실패, 기본값 사용: ${settingsPath()} — ${describeError(err)}`);
    }
    return DEFAULT_SETTINGS;
  }
}

/** 부분 patch를 현재 저장된 값 위에 merge해서 쓴다 — 서로 다른 모듈(서비스
 * 켜기/끄기, 테마 선택)이 각자 자기 필드만 넘겨도 상대 필드를 덮어쓰지
 * 않게 하려는 것. */
export function saveSettings(patch: Partial<AppSettings>): void {
  const next: AppSettings = { ...loadSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
  } catch (err) {
    // 디스크 공간 부족 등으로 저장이 실패해도, 이미 켜둔 서비스의 단축키
    // 자체는 이번 실행에서 계속 동작해야 한다 — 다음 재시작에 안 남는 것만
    // 문제이므로 로그만 남기고 앱은 계속 진행한다.
    appLog.error('settings', `설정 저장 실패: ${settingsPath()} — ${describeError(err)}`);
  }
}
