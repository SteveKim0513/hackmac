/**
 * 실행 서버(Electron 메인)와 플랫폼 모듈(modules/platform)을 잇는 유일한 자리.
 * Electron만 할 수 있는 것(globalShortcut, 팝업 소켓 경로, 알림, "실행 중" 표시)을 여기서 주입하고,
 * 나머지(보관소·자리·실행기·원장·설정)는 Electron 없이 시험된 모듈이 맡는다.
 *
 * 렌더러 계약은 아직 v1(ServiceMeta)이다 — 화면을 새로 그리기 전까지 AppView를 ServiceMeta로 바꿔 준다.
 */
import { app, globalShortcut, Notification, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Trigger } from '../shared/manifest';
import type { ActivateResult, ServiceMeta, ThemePreference } from '../shared/types';
import { ensureDirs, Platform, type AppView, type HotkeyPort } from '../modules/platform/platform';
import type { RunResult } from '../modules/runner/runner';
import { SecretStore } from '../modules/secrets/secrets';
import { cleanupOldLogs } from './exec-log';
import { appLog, describeError, serviceTag } from './log';
import { popupClientJsPath, popupSocketPath, popupWrapperPath, servicesDir } from './paths';
import { hideRunningStatus, showRunningStatus } from './popupWindow';

/** 이 HackMac이 가진 능력과 버전. 앱의 `capabilities: { popup: ">=1" }`가 여기와 맞춰진다 */
export const CAPABILITIES: Record<string, number> = { popup: 1 };

const SETTINGS_FILE = 'settings.json';

/** v1 settings.json(`activeServiceIds`, `themePreference`)을 v2 모양으로 한 번 바꾼다. 이미 v2면 손대지 않는다 */
function migrateV1Settings(file: string): void {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  if (!raw || typeof raw !== 'object' || raw.schema === 1) return;
  const ids = Array.isArray(raw.activeServiceIds) ? (raw.activeServiceIds as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const next = {
    schema: 1,
    enabled: ids.map((id) => `hackmac.${id}`),
    hotkeys: {},
    hotkeysPrevious: {},
    appSettings: {},
    theme: raw.themePreference ?? 'system',
    engine: null,
  };
  fs.copyFileSync(file, `${file}.v1`);
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
  appLog.info('platform', `v1 설정을 v2로 옮김: ${ids.join(', ') || '(켜진 서비스 없음)'}`);
}

const electronHotkeys: HotkeyPort = {
  register: (accelerator, cb) => {
    try {
      return globalShortcut.register(accelerator, cb);
    } catch (err) {
      appLog.warn('hotkeys', `register 예외 — ${accelerator}: ${describeError(err)}`);
      return false;
    }
  },
  unregister: (accelerator) => globalShortcut.unregister(accelerator),
};

function notifyFailure(name: string, r: RunResult): void {
  if (r.success) return; // 성공은 스크립트 자신이 알린다
  const body = r.stderr.trim().slice(0, 200) || `문제가 생겼어요 (종료 코드 ${r.code ?? r.signal ?? '없음'})`;
  new Notification({ title: `⚠️ ${name} 실행에 실패했어요`, body }).show();
}

export function createPlatform(): Platform {
  const userData = app.getPath('userData');
  const paths = {
    apps: path.join(userData, 'apps'),
    logs: app.getPath('logs'),
    ledger: path.join(userData, 'ledger'),
    settings: path.join(userData, SETTINGS_FILE),
  };
  ensureDirs(paths);
  migrateV1Settings(paths.settings);

  // 비밀값은 키체인이 쥔 키로 암호화해서 둔다(safeStorage). 쓸 수 없으면 저장을 거절한다
  const secrets = new SecretStore(path.join(userData, 'secrets.json'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (cipher) => safeStorage.decryptString(cipher),
  });

  const platform = new Platform({
    paths,
    secrets,
    capabilities: CAPABILITIES,
    capabilityEnv: () => ({
      HACKMAC_POPUP: popupWrapperPath(),
      HACKMAC_POPUP_SOCK: popupSocketPath(),
      HACKMAC_ELECTRON_BIN: process.execPath,
      HACKMAC_POPUP_CLIENT_JS: popupClientJsPath(),
    }),
    hotkeys: electronHotkeys,
    hackmacVersion: app.getVersion(),
    hooks: {
      onHotkeyRunStart: (appId, t) => {
        appLog.info('platform', `${serviceTag(appId)} 단축키 실행: ${t.name}`);
        showRunningStatus(`${t.name} 실행 중…`);
      },
      onHotkeyRunEnd: (appId, t, r) => {
        hideRunningStatus();
        appLog.info('platform', `${serviceTag(appId)} 단축키 실행 완료: ${t.name} — 성공=${r.success} 코드=${r.code ?? '없음'} 로그=${r.logPath}`);
        notifyFailure(t.name, r);
      },
    },
  });

  const bundled = platform.installBundledV1(servicesDir());
  if (bundled.installed.length) appLog.info('platform', `번들 서비스 설치: ${bundled.installed.join(', ')}`);
  for (const e of bundled.errors) appLog.error('platform', `번들 서비스 설치 실패: ${e}`);

  // 보관 기간 [시작값]: 실행 로그 14일(v1과 같음), 원장 90일(자가 유지보수가 지난 실패를 볼 수 있게 더 길게).
  void cleanupOldLogs(14).catch((err) => appLog.warn('platform', `실행 로그 정리 실패: ${describeError(err)}`));
  try {
    platform.ledger.prune(90);
  } catch (err) {
    appLog.warn('platform', `원장 정리 실패: ${describeError(err)}`);
  }

  const restored = platform.restore();
  appLog.info('platform', `복원: 켜짐 ${restored.enabled.length}개, 실패 ${restored.failed.length}개`);
  for (const f of restored.failed) appLog.warn('platform', `${serviceTag(f.id)} 복원 실패: ${f.reason}`);
  return platform;
}

/** v1 렌더러가 읽는 모양으로. 단축키 열은 배정된 자리, 못 붙은 트리거는 hotkeyError */
export function toServiceMeta(v: AppView): ServiceMeta | null {
  const m = v.manifest;
  if (!m) return null;
  const problemFor = (name: string) => v.problems.find((p) => p.startsWith(`${name}:`))?.slice(name.length + 1).trim() ?? null;
  const shortcuts = m.triggers
    .filter((t): t is Extract<Trigger, { kind: 'hotkey' }> => t.kind === 'hotkey')
    .map((t) => ({
      id: t.key,
      scriptPath: t.script,
      name: t.name,
      hotkey: v.hotkeys.find((h) => h.key === t.key)?.slot ?? null,
      description: t.description ?? null,
      hotkeyError: problemFor(t.name),
    }));
  return {
    id: v.id,
    name: m.name,
    tagline: m.tagline,
    icon: m.icon,
    accentColor: m.accentColor ?? '#5e5ce6',
    whatItIs: m.whatItIs ?? [],
    differentiators: m.differentiators ?? [],
    strengths: m.strengths ?? [],
    usage: m.usage,
    shortcuts,
    isActive: v.enabled,
  };
}

export function listServices(p: Platform): ServiceMeta[] {
  return p.list().map(toServiceMeta).filter((x): x is ServiceMeta => x !== null).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export function activateService(p: Platform, id: string): ActivateResult {
  const r = p.enable(id);
  if (!r.ok) {
    appLog.warn('platform', `${serviceTag(id)} 켜기 실패: ${r.reason}`);
    return { ok: false, errors: [{ shortcutId: id, name: id, message: r.reason }] };
  }
  for (const pr of r.problems) appLog.warn('platform', `${serviceTag(id)} ${pr}`);
  return { ok: r.problems.length === 0, errors: r.problems.map((message) => ({ shortcutId: id, name: id, message })) };
}

export function themeOf(p: Platform): ThemePreference {
  return p.settings.get().theme;
}
