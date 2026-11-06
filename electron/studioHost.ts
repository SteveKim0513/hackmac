/**
 * 작업실(계정·스레드·채팅)을 Electron에 붙이는 자리. 모듈(modules/account, conversation, thread, studio)은 Electron 없이 시험되고,
 * 여기는 IPC와 창으로 사건을 보내는 일만 한다.
 *
 * 지금은 실행 서버와 같은 메인 프로세스에서 돈다. 계획서 5절의 `--role=studio` 분리와 엔진 지기(utilityProcess)는
 * 이 파일만 옮기면 되도록 모듈 쪽에 Electron 의존을 두지 않았다.
 *
 * HACKMAC_CLI_DIRS(콜론 구분)가 있으면 그 폴더에서만 CLI를 찾는다 — E2E가 가짜 CLI를 쓰게 하려는 것.
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseEngine } from '../modules/account/choose';
import { cliStatus, envFor, resolveBin, run, searchDirs, VENDORS, type CliStatus, type Vendor } from '../modules/account/cli';
import { createLogins, fileLogger, type LoginView } from '../modules/account/login';
import type { Platform } from '../modules/platform/platform';
import { agentOptions, builderInstructions, type AgentPaths } from '../modules/build/agent';
import { Builder } from '../modules/build/builder';
import type { BuildState } from '../modules/build/progress';
import { askOnce } from '../modules/conversation/once';
import { Chats, type ChatEvent } from '../modules/studio/chat';
import { readPackage } from '../modules/store/store';
import { ThreadStore, type ThreadMeta } from '../modules/thread/thread';
import { CAPABILITIES } from './platformHost';
import type { AccountsView, ThreadView, VendorView } from '../shared/studio';
import { appLog, describeError } from './log';
import { agentDocs, buildClientJsPath, buildWrapperPath, popupStubPath } from './paths';

const VENDOR_NAME: Record<Vendor, string> = { claude: 'Claude', codex: 'Codex' };

/** 사용자 macOS 버전(평가에 쓴다). 못 읽으면 커널 버전 */
const macosVersion = (): string => {
  try {
    return `macOS ${execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()}`;
  } catch {
    return `Darwin ${os.release()}`;
  }
};

const cliDirs = (): string[] => (process.env.HACKMAC_CLI_DIRS ? process.env.HACKMAC_CLI_DIRS.split(path.delimiter).filter(Boolean) : searchDirs());
const binFor = (v: Vendor): string | null => resolveBin(v, cliDirs());

const broadcast = (channel: string, payload: unknown): void => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
};

export function startStudio(platform: Platform): { stop: () => Promise<void> } {
  const threads = new ThreadStore(path.join(app.getPath('userData'), 'threads'));
  const logins = createLogins({ spawn, bin: binFor, log: fileLogger(path.join(app.getPath('logs'), 'accounts')) });
  let vendors: Record<Vendor, VendorView> | null = null;

  const detect = async (): Promise<Record<Vendor, VendorView>> => {
    const entries = await Promise.all(
      VENDORS.map(async (v) => {
        try {
          const r = await cliStatus(v, {}, { bin: binFor, run });
          const s: CliStatus = r.status ?? { loggedIn: false, email: null, plan: null, method: null, identity: null };
          return [v, { ...s, installed: r.installed }] as const;
        } catch (err) {
          appLog.warn('studio', `${v} 상태 확인 실패: ${describeError(err)}`);
          return [v, { loggedIn: false, email: null, plan: null, method: null, identity: null, installed: false }] as const;
        }
      }),
    );
    vendors = Object.fromEntries(entries) as Record<Vendor, VendorView>;
    appLog.info('studio', `엔진 감지: ${VENDORS.map((v) => `${v}=${vendors![v].installed ? (vendors![v].loggedIn ? '로그인' : '설치만') : '없음'}`).join(', ')}`);
    return vendors;
  };

  const view = async (refresh: boolean): Promise<AccountsView> => {
    const vs = refresh || !vendors ? await detect() : vendors;
    const saved = platform.settings.get().engine;
    const choice = chooseEngine(vs, saved);
    // 하나뿐이거나 저장된 쪽이 로그아웃돼 남은 쪽을 쓰게 되면 그 선택을 저장한다(계획서 6.1: 묻지 않고 쓴다)
    if (choice.kind === 'use' && choice.vendor !== saved) platform.settings.update({ engine: choice.vendor });
    return { vendors: vs, choice, engine: choice.kind === 'use' ? choice.vendor : null };
  };

  const engineFor = (v: Vendor) => {
    if (!vendors?.[v]?.loggedIn) return null;
    const bin = binFor(v);
    return bin ? { bin, env: envFor(bin) } : null;
  };

  // ── 제작(4단계) ──────────────────────────────
  for (const f of [buildWrapperPath(), buildClientJsPath(), popupStubPath()]) {
    try { chmodSync(f, 0o755); } catch (err) { appLog.warn('studio', `실행 권한 설정 실패: ${f} — ${describeError(err)}`); }
  }
  const docs = agentDocs();
  const agentPaths: AgentPaths = {
    buildWrapper: buildWrapperPath(),
    buildClientJs: buildClientJsPath(),
    electronBin: process.execPath,
    docs: [
      { label: 'Apple 앱 데이터 접근 진단(첨부·링크·폴더 등 기본 필드 밖 데이터를 읽기 전에)', path: docs.appleGuide },
      ...(docs.manifestDoc ? [{ label: '앱 선언 설계 문서(예시의 tray·notify·ai는 아직 없는 능력)', path: docs.manifestDoc }] : []),
    ],
  };
  const capabilitiesText = readFileSync(docs.capabilities, 'utf8');
  const instructions = builderInstructions(readFileSync(docs.builder, 'utf8'), capabilitiesText, agentPaths.docs);
  const appleGuide = (() => { try { return readFileSync(docs.appleGuide, 'utf8').slice(0, 6000); } catch { return undefined; } })();
  const macos = macosVersion();

  const builders = new Map<string, Builder>();
  const builderFor = (threadId: string): Builder => {
    let b = builders.get(threadId);
    if (b) return b;
    const work = realpathSync(threads.workDir(threadId));
    b = new Builder({
      workDir: work,
      progressFile: path.join(threads.dirOf(threadId), 'progress.jsonl'),
      gate: { capabilities: CAPABILITIES, realHome: os.homedir(), popupStub: popupStubPath() },
      // 계획서 7.2: 만드는 쪽이 아닌 역할이 평가한다. 두 회사가 다 로그인돼 있으면 다른 회사에게
      evaluator: () => {
        const builderVendor = threads.get(threadId)?.vendor ?? platform.settings.get().engine;
        const order = VENDORS.filter((v) => v !== builderVendor).concat(builderVendor ? [builderVendor] : []);
        const v = order.find((x) => engineFor(x));
        if (!v) return null;
        const eng = engineFor(v)!;
        return {
          by: VENDOR_NAME[v],
          ask: async (prompt: string) => {
            const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'hackmac-eval-')));
            try {
              return await askOnce(v, { bin: eng.bin, cwd: dir, env: eng.env, allowedTools: [] }, prompt);
            } finally {
              rmSync(dir, { recursive: true, force: true });
            }
          },
        };
      },
      evaluateContext: { capabilities: capabilitiesText, appleGuide, macosVersion: macos },
      installedVersion: (appId) => {
        const dir = platform.store.currentDir(appId);
        const r = dir ? readPackage(dir) : null;
        return r?.ok ? r.manifest.version : null;
      },
      install: (pkgDir) => {
        const r = platform.install(pkgDir);
        if (r.ok) {
          threads.update(threadId, { appId: r.id });
          appLog.info('studio', `스레드 ${threadId} → 앱 설치 ${r.id} v${r.version}`);
          broadcast('services:changed', null);
        }
        return r.ok ? { ok: true, id: r.id, version: r.version } : { ok: false, errors: r.errors };
      },
      onState: (state: BuildState) => broadcast('build:state', { threadId, state }),
    });
    b.start();
    builders.set(threadId, b);
    return b;
  };

  const chats = new Chats({
    threads,
    defaultVendor: () => {
      const saved = platform.settings.get().engine;
      return saved && vendors?.[saved]?.loggedIn ? saved : null;
    },
    engineFor,
    instructions,
    optionsFor: (vendor, threadId, cwd) => {
      builderFor(threadId);
      return agentOptions(vendor, cwd, agentPaths);
    },
    onEvent: (threadId: string, e: ChatEvent) => {
      if (e.kind === 'turnEnd' && e.error) appLog.warn('studio', `스레드 ${threadId} 턴 실패: ${e.error}`);
      if (e.kind === 'exit' && !e.expected) appLog.warn('studio', `스레드 ${threadId} 엔진이 끝남: 코드 ${e.code ?? e.signal}`);
      broadcast('chat:event', { threadId, event: e });
    },
  });

  ipcMain.handle('accounts:get', (_e, refresh: boolean) => view(Boolean(refresh)));
  ipcMain.handle('accounts:choose', async (_e, v: Vendor) => {
    if (!VENDORS.includes(v)) throw new Error(`모르는 엔진: ${v}`);
    platform.settings.update({ engine: v });
    return view(false);
  });
  ipcMain.handle('login:start', (_e, v: Vendor): LoginView => {
    // CLI가 브라우저를 직접 연다. 안 열렸을 때만 화면의 주소 버튼을 누른다
    return logins.start(v, v, {}, (ok) => {
      appLog.info('studio', `${v} 로그인 ${ok ? '성공' : '실패'}`);
      void view(true).then((a) => broadcast('accounts:changed', a));
    });
  });
  ipcMain.handle('login:state', (_e, v: Vendor) => logins.state(v));
  ipcMain.handle('login:submit', (_e, v: Vendor, code: string) => logins.submit(v, code));
  ipcMain.handle('login:cancel', (_e, v: Vendor) => logins.cancel(v));
  ipcMain.handle('login:openUrl', (_e, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
  });

  ipcMain.handle('threads:list', (): ThreadView[] => threads.list().map((meta) => ({ meta, messages: [], busy: chats.busy(meta.id) })));
  ipcMain.handle('threads:create', (_e, title: string): ThreadMeta => threads.create(String(title ?? '')));
  ipcMain.handle('threads:get', (_e, id: string): ThreadView | null => {
    const meta = threads.get(id);
    return meta ? { meta, messages: threads.messages(id), busy: chats.busy(id) } : null;
  });
  ipcMain.handle('chat:send', (_e, id: string, text: string) => chats.send(id, String(text ?? '')));
  ipcMain.handle('chat:interrupt', (_e, id: string) => chats.interrupt(id));
  ipcMain.handle('build:get', (_e, id: string): BuildState | null => (threads.get(id) ? builderFor(id).state() : null));

  void view(true).catch((err) => appLog.error('studio', `엔진 감지 실패: ${describeError(err)}`));

  return {
    stop: async () => {
      for (const b of builders.values()) b.stop();
      await chats.stopAll();
    },
  };
}
