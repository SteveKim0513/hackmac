/** One hotkey-triggered script inside a service. Metadata lives in the
 * script's own `@svc-*` header comments — the .sh file is the source of
 * truth, same principle mac-shortcut-manager uses for its shortcuts. */
export interface ServiceShortcut {
  id: string;
  scriptPath: string;
  name: string;
  hotkey: string | null;
  description: string | null;
  /** Set when `hotkey` failed to register (already claimed by this app or another). */
  hotkeyError: string | null;
}

/** Store-page copy for a service — read from that service's manifest.json.
 * Unlike shortcut metadata, this doesn't map to a single script, so it
 * can't live in a script header. */
export interface ServiceManifest {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  accentColor: string;
  /** Paragraphs, rendered in order. When the service is built on a concept
   * the reader may not know (GTD, Pomodoro, ...), this is where it gets
   * explained from zero — see docs/service-copy-guide.md. */
  whatItIs: string[];
  differentiators: string[];
  strengths: string[];
  usage: string[];
}

export interface ServiceMeta extends ServiceManifest {
  shortcuts: ServiceShortcut[];
  isActive: boolean;
}

export interface RunResult {
  success: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** 이번 실행의 상세 로그가 담긴 파일 경로 — app.log의 요약 한 줄에서
   * 이 파일로 바로 점프할 수 있게 항상 채워둔다. */
  logPath: string;
}

export interface ActivateResult {
  ok: boolean;
  errors: { shortcutId: string; name: string; message: string }[];
}

/** `system`은 macOS의 현재 라이트/다크 설정을 그대로 따라간다 — `electron/main.ts`가
 * 이 값을 `nativeTheme.themeSource`에 그대로 대입하면, 렌더러의
 * `prefers-color-scheme` 미디어쿼리(`src/theme.css`)가 창 리로드 없이
 * 즉시 갱신된다. */
export type ThemePreference = 'light' | 'dark' | 'system';

export type UpdateCheckResult =
  | { status: 'up-to-date' }
  | { status: 'downloading'; version: string }
  | { status: 'error'; message: string }
  | { status: 'disabled' };

/** `select`의 한 항목 — `group`이 있으면 팝업이 같은 그룹끼리 묶어 구간
 * 헤더를 보여준다(예: 업무/개인, `resources/bin/hackmac-popup`의 그룹 인코딩
 * 참고). `group`이 `null`인 항목만 있으면 기존과 동일한 민짜 리스트로
 * 보인다. 선택/기본값 비교와 스크립트로 돌아가는 값은 항상 `label`이다 —
 * `group`은 화면 표시에만 쓰인다. */
export interface SelectItem {
  label: string;
  group: string | null;
}

/** Interactive moments a service script needs mid-run — the popup window
 * these render in replaces `display dialog`/`choose from list` (see
 * docs/design.md). `select` covers `choose from list`, `prompt` covers
 * `display dialog ... default answer`, `confirm` covers a plain
 * `display dialog` with only buttons, `date` covers picking a calendar
 * date (there is no osascript equivalent this replaces — AppleScript has
 * no built-in date-picker dialog). `date`'s `defaultValue`/result value is
 * always a `YYYY-MM-DD` string in the local timezone; `markedDates` is an
 * optional list of the same format the calendar dots under (e.g. days that
 * already have data worth looking at).
 *
 * `status`는 스크립트가 요청하는 게 아니라 `electron/services.ts`가 단축키
 * 콜백에서 스크립트를 spawn하기 직전에 직접 띄우는, 앱 내부 전용 종류다 —
 * 버튼도 취소도 없이 "지금 실행 중"만 보여주고, 스크립트의 첫 실제 팝업
 * 요청이 오거나(그 요청이 이 창을 대신 밀어낸다) 스크립트가 끝나면
 * 프로그램적으로 닫힌다. 사용자가 직접 닫을 방법은 없다. */
export type PopupRequest =
  | { kind: 'select'; title: string; prompt: string; okLabel: string; cancelLabel: string; items: SelectItem[]; defaultItem: string | null }
  | { kind: 'prompt'; title: string; prompt: string; okLabel: string; cancelLabel: string; defaultValue: string }
  | { kind: 'confirm'; title: string; prompt: string; okLabel: string; cancelLabel: string }
  | { kind: 'date'; title: string; prompt: string; okLabel: string; cancelLabel: string; defaultValue: string; markedDates: string[] }
  | { kind: 'status'; title: string; prompt: string };

/** `ok: false` means the user cancelled (Escape, cancel button, or closed
 * the window) — same meaning as AppleScript's user-cancelled error -128. */
export type PopupResult = { ok: true; value: string | null } | { ok: false; value: null };
