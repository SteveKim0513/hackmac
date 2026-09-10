import { globalShortcut } from 'electron';

interface Claim {
  accelerator: string;
  ownerId: string;
  ownerLabel: string;
  callback: () => void;
}

export interface ClaimResult {
  ok: boolean;
  /** Set when another owner (a different service's shortcut) already holds
   * this accelerator, so the caller can name the conflict instead of just
   * failing silently. */
  conflictLabel?: string;
}

// `globalShortcut.register()` silently *replaces* a same-process
// registration on a second call rather than failing it — see
// mac-shortcut-manager/CLAUDE.md. Without a single owner-tracking layer,
// two services sharing a hotkey would fail invisibly: whichever activated
// last would just win, with no error shown anywhere. Every claim in this
// app goes through here instead of calling globalShortcut directly.
class HotkeyRegistrar {
  private claims = new Map<string, Claim>(); // accelerator -> claim

  claim(accelerator: string, ownerId: string, ownerLabel: string, callback: () => void): ClaimResult {
    const existing = this.claims.get(accelerator);
    if (existing && existing.ownerId !== ownerId) {
      return { ok: false, conflictLabel: existing.ownerLabel };
    }
    if (existing && existing.ownerId === ownerId) {
      return { ok: true };
    }

    const registered = globalShortcut.register(accelerator, callback);
    if (!registered) return { ok: false };
    this.claims.set(accelerator, { accelerator, ownerId, ownerLabel, callback });
    return { ok: true };
  }

  /** Releases every accelerator held by `ownerId` (a service was deactivated). */
  release(ownerId: string): void {
    for (const [accel, claim] of [...this.claims]) {
      if (claim.ownerId === ownerId) {
        globalShortcut.unregister(accel);
        this.claims.delete(accel);
      }
    }
  }

  releaseAll(): void {
    for (const accel of this.claims.keys()) globalShortcut.unregister(accel);
    this.claims.clear();
  }
}

export const hotkeyRegistrar = new HotkeyRegistrar();
