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

/** Interactive moments a service script needs mid-run — the popup window
 * these render in replaces `display dialog`/`choose from list` (see
 * docs/design.md). `select` covers `choose from list`, `prompt` covers
 * `display dialog ... default answer`, `confirm` covers a plain
 * `display dialog` with only buttons, `date` covers picking a calendar
 * date (there is no osascript equivalent this replaces — AppleScript has
 * no built-in date-picker dialog). `date`'s `defaultValue`/result value is
 * always a `YYYY-MM-DD` string in the local timezone. */
export type PopupRequest =
  | { kind: 'select'; title: string; prompt: string; okLabel: string; cancelLabel: string; items: string[]; defaultItem: string | null }
  | { kind: 'prompt'; title: string; prompt: string; okLabel: string; cancelLabel: string; defaultValue: string }
  | { kind: 'confirm'; title: string; prompt: string; okLabel: string; cancelLabel: string }
  | { kind: 'date'; title: string; prompt: string; okLabel: string; cancelLabel: string; defaultValue: string };

/** `ok: false` means the user cancelled (Escape, cancel button, or closed
 * the window) — same meaning as AppleScript's user-cancelled error -128. */
export type PopupResult = { ok: true; value: string | null } | { ok: false; value: null };
