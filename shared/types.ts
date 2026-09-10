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
}

export interface ActivateResult {
  ok: boolean;
  errors: { shortcutId: string; name: string; message: string }[];
}

export type UpdateCheckResult =
  | { status: 'up-to-date' }
  | { status: 'downloading'; version: string }
  | { status: 'error'; message: string }
  | { status: 'disabled' };
