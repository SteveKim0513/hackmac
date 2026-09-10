import { Notification } from 'electron';
import type { RunResult, ServiceShortcut } from '../shared/types';

/** Shown for every hotkey-triggered run. Wording stays warm and plain — a
 * raw exit code means nothing to most people, so it only shows up as a soft
 * parenthetical, never the whole message. */
export function notifyRunResult(shortcut: ServiceShortcut, result: RunResult): void {
  if (result.success) return; // the script itself notifies on success (or shows a dialog)
  const title = `⚠️ ${shortcut.name} 실행에 실패했어요`;
  const body = result.stderr.trim().slice(0, 200) || `문제가 생겼어요 (종료 코드 ${result.code})`;
  new Notification({ title, body }).show();
}
