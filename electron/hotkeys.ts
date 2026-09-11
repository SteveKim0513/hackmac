import { globalShortcut } from 'electron';
import { appLog, serviceTag } from './log';

/** ownerId is always `${serviceId}:${scriptPath}` (see services.ts) — macOS
 * paths never contain ':', so splitting on the first one safely recovers
 * the service id for tagging log lines. */
function serviceIdOf(ownerId: string): string {
  return ownerId.slice(0, ownerId.indexOf(':'));
}

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
      appLog.warn(
        'hotkeys',
        `${serviceTag(serviceIdOf(ownerId))} 클레임 거부 — ${accelerator}는 이미 ${serviceTag(serviceIdOf(existing.ownerId))}(${existing.ownerLabel})가 씀, 요청 라벨 ${ownerLabel}`,
      );
      return { ok: false, conflictLabel: existing.ownerLabel };
    }
    if (existing && existing.ownerId === ownerId) {
      return { ok: true };
    }

    const registered = globalShortcut.register(accelerator, callback);
    if (!registered) {
      // globalShortcut.register()는 실패 이유를 알려주지 않는다 — macOS
      // 시스템 단축키나 다른 앱이 이미 쓰고 있는 경우로 추정만 가능하다.
      appLog.warn('hotkeys', `${serviceTag(serviceIdOf(ownerId))} globalShortcut.register 실패(원인 불명) — ${accelerator}, 라벨 ${ownerLabel}`);
      return { ok: false };
    }
    this.claims.set(accelerator, { accelerator, ownerId, ownerLabel, callback });
    appLog.info('hotkeys', `${serviceTag(serviceIdOf(ownerId))} 클레임 성공 — ${accelerator} -> ${ownerLabel}`);
    return { ok: true };
  }

  /** Releases every accelerator held by `ownerId` (a service was deactivated). */
  release(ownerId: string): void {
    for (const [accel, claim] of [...this.claims]) {
      if (claim.ownerId === ownerId) {
        globalShortcut.unregister(accel);
        this.claims.delete(accel);
        appLog.info('hotkeys', `${serviceTag(serviceIdOf(ownerId))} 해제 — ${accel}`);
      }
    }
  }

  releaseAll(): void {
    for (const accel of this.claims.keys()) globalShortcut.unregister(accel);
    if (this.claims.size > 0) appLog.info('hotkeys', `전체 해제 — ${this.claims.size}건`);
    this.claims.clear();
  }
}

export const hotkeyRegistrar = new HotkeyRegistrar();
