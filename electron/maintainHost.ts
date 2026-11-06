/**
 * 자가 유지보수(계획서 11)를 Electron에 붙이는 자리. 판단은 modules/maintain이 하고(Electron 없이 시험됨),
 * 여기는 팝업·알림·IPC·타이머만 맡는다.
 *
 * 안내는 앱 자신의 팝업(요구 1: 이 앱 안에서 사용자에게 알리거나 확인받는 일은 전부 이 팝업을 거친다 — docs/design.md)으로 띄운다.
 * "문제를 알리는" 팝업은 취소 버튼 없이(cancelLabel ''), "고쳤는데 적용할까요"는 [적용]/[나중에]다. [나중에]는 지우지 않는다 —
 * 앱 상세에서 언제든 적용하거나 버릴 수 있다.
 */
import { app, ipcMain, Notification, shell } from 'electron';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { builderInstructions } from '../modules/build/agent';
import { Maintainer, type PendingFix } from '../modules/maintain/maintainer';
import { createTeam } from '../modules/maintain/team';
import type { Platform } from '../modules/platform/platform';
import { CAPABILITIES } from './platformHost';
import { popupStubPath } from './paths';
import { requestPopup } from './popupWindow';
import { appLog, describeError } from './log';
import type { StudioServices } from './studioHost';
import type { MaintenanceView } from '../shared/studio';

const MAINTAINER_DOC_FALLBACK = '너는 HackMac 유지보수 담당이다. 실패한 앱을 고쳐 검증을 통과시킨 뒤 submit 한다.';

/** 로그 폴더에서 그 앱의 가장 최근 실행 로그(<logs>/<앱id>/<날짜>/*.log) */
const newestLog = (logsRoot: string, appId: string): string | null => {
  try {
    const base = path.join(logsRoot, appId);
    const day = readdirSync(base).sort().at(-1);
    if (!day) return null;
    const files = readdirSync(path.join(base, day)).map((f) => path.join(base, day, f));
    return files.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs).at(-1) ?? null;
  } catch {
    return null;
  }
};

const tailOf = (file: string | null, n = 8000): string => {
  if (!file) return '';
  try {
    const t = readFileSync(file, 'utf8');
    return t.length > n ? t.slice(-n) : t;
  } catch {
    return '';
  }
};


export function startMaintain(platform: Platform, studio: StudioServices): { stop: () => void } {
  const logsRoot = app.getPath('logs');
  const pendingRoot = path.join(app.getPath('userData'), 'maintenance', 'pending');
  let maintainer: Maintainer;

  let instructions = MAINTAINER_DOC_FALLBACK;
  try {
    instructions = builderInstructions(readFileSync(studio.docs.maintainer, 'utf8'), studio.capabilitiesText, studio.agentPaths.docs);
  } catch (err) {
    appLog.error('maintain', `유지보수 지시문을 읽지 못함: ${describeError(err)}`);
  }

  const versionOf = (id: string): string | null => {
    const dir = platform.store.currentDir(id);
    if (!dir) return null;
    try {
      return String((JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { version?: unknown }).version ?? '');
    } catch {
      return null;
    }
  };

  const team = createTeam({
    currentPackage: (id) => platform.store.currentDir(id),
    installedVersion: versionOf,
    gate: { capabilities: CAPABILITIES, realHome: os.homedir(), popupStub: popupStubPath() },
    engine: () => studio.pickEngine(),
    agentPaths: studio.agentPaths,
    instructions,
    ledgerText: (id) => platform.ledger.read({ days: 7, appId: id }).map((e) => `${e.at} ${e.kind} ${JSON.stringify({ ...e, at: undefined, kind: undefined, appId: undefined })}`).join('\n'),
    memoryText: (id) => studio.memoryOfApp(id),
  });

  const info = (title: string, prompt: string, ok = '확인') => void requestPopup({ kind: 'confirm', title, prompt, okLabel: ok, cancelLabel: '' }).catch(() => {});

  maintainer = new Maintainer({
    ledger: platform.ledger,
    pendingRoot,
    app: (id) => {
      const v = platform.list().find((x) => x.id === id);
      return v?.manifest ? { name: v.manifest.name, enabled: v.enabled } : null;
    },
    readLog: (id, logPath) => tailOf(logPath ?? newestLog(logsRoot, id)),
    team: async (inc, stage) => {
      appLog.info('maintain', `${inc.appId} 유지보수 팀 호출: ${inc.diag.summary} (${inc.diag.cause}, ${inc.occurrences}회)`);
      const r = await team(inc, stage);
      appLog.info('maintain', `${inc.appId} 유지보수 결과: ${r.ok ? `수정본 보관 — ${r.summary}` : `못 고침 — ${r.reason}`}`);
      return r;
    },
    applyFix: (dir, id) => platform.applyFix(dir, id),
    userBusy: () => studio.userBusy(),
    autoApply: () => platform.settings.get().autoApplyFixes,
    threadNotice: (id, text) => void studio.noticeForApp(id, text),
    ui: {
      advise: (_id, _name, a) => {
        void requestPopup({ kind: 'confirm', title: a.title, prompt: a.body, okLabel: a.action?.label ?? '확인', cancelLabel: a.action ? '닫기' : '' })
          .then((r) => { if (r.ok && a.action) void shell.openExternal(a.action.url); })
          .catch(() => {});
      },
      offerFix: (fix: PendingFix) => {
        void requestPopup({ kind: 'confirm', title: `${fix.appName}에 생긴 문제를 고쳤어요`, prompt: `${fix.problem}\n\n고친 것: ${fix.summary}`, okLabel: '적용', cancelLabel: '나중에' })
          .then(async (r) => {
            if (!r.ok) return;
            const a = await maintainer.apply(fix.id);
            if (!a.ok) info('적용하지 못했어요', a.error);
          })
          .catch(() => {});
      },
      notifyApplied: (fix, version) => {
        new Notification({ title: `${fix.appName}을(를) 자동으로 고쳤어요`, body: `${fix.summary}(버전 ${version})` }).show();
      },
      notifyUnfixed: (_id, name, reason) => info(`${name}을(를) 고치지 못했어요`, `자동으로 고쳐 보려 했지만 안 됐어요.\n${reason}\n\n앱은 그대로 두었어요. 앱 화면의 대화에서 직접 고쳐 달라고 말할 수도 있어요.`),
    },
  });

  const off = platform.subscribe((e) => maintainer.handle(e));
  const timer = setInterval(() => maintainer.tick(), 60_000);
  timer.unref();
  // 켜자마자: 지난번에 못 알린 수정본(밤에 만든 것 등)이 있으면 알린다
  setTimeout(() => maintainer.tick(), 5_000).unref();

  const view = (appId: string): MaintenanceView => ({
    pending: maintainer.pending(appId).map(({ id, problem, summary, createdAt }) => ({ id, problem, summary, createdAt })),
    history: maintainer.history(appId).slice(0, 20),
    autoApply: platform.settings.get().autoApplyFixes,
  });

  ipcMain.handle('maintenance:get', (_e, appId: string): MaintenanceView => view(String(appId)));
  ipcMain.handle('maintenance:apply', async (_e, fixId: string) => {
    const r = await maintainer.apply(String(fixId));
    appLog.info('maintain', `수정본 적용 ${fixId}: ${r.ok ? `버전 ${r.version}` : r.error}`);
    return r;
  });
  ipcMain.handle('maintenance:dismiss', (_e, fixId: string) => maintainer.dismiss(String(fixId)));
  ipcMain.handle('maintenance:setAuto', (_e, on: boolean) => {
    platform.settings.update({ autoApplyFixes: on === true });
    return on === true;
  });

  return {
    stop: () => {
      off();
      clearInterval(timer);
      maintainer.stop();
    },
  };
}
