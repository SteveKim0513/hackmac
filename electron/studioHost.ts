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
import { AccountStore, configDirOf } from '../modules/account/accounts';
import { chooseEngine } from '../modules/account/choose';
import { copySession } from '../modules/account/session';
import { cliStatus, envFor, resolveBin, run, searchDirs, VENDORS, type Vendor } from '../modules/account/cli';
import { createLogins, fileLogger, type LoginView } from '../modules/account/login';
import { createInstalls, type InstallView } from '../modules/prepare/install';
import type { Platform } from '../modules/platform/platform';
import { agentOptions, builderInstructions, type AgentPaths } from '../modules/build/agent';
import { Builder } from '../modules/build/builder';
import type { BuildState } from '../modules/build/progress';
import { askOnce } from '../modules/conversation/once';
import { Chats, type ChatEvent } from '../modules/studio/chat';
import { readPackage } from '../modules/store/store';
import { ThreadStore, type ThreadMeta } from '../modules/thread/thread';
import { CAPABILITIES } from './platformHost';
import type { AccountsView, AccountView, ThreadView, VendorView } from '../shared/studio';
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
  const accounts = new AccountStore(path.join(app.getPath('userData'), 'accounts.json'), path.join(app.getPath('userData'), 'accounts'));
  // 계정마다 마지막으로 확인한 상태(id → 상태). 로그인·설치·계정 추가가 끝날 때마다 다시 확인한다
  let statuses: Map<string, VendorView> | null = null;
  const NONE: VendorView = { loggedIn: false, email: null, plan: null, method: null, identity: null, installed: false };
  // 준비: 없는 CLI를 공식 설치 스크립트로 깐다. HACKMAC_INSTALL_SCRIPT_<VENDOR>는 E2E 전용(진짜 설치기 대신 가짜 CLI를 놓는다)
  const accountsLog = fileLogger(path.join(app.getPath('logs'), 'accounts'));
  const installs = createInstalls({
    spawn,
    home: os.homedir(),
    binDirs: cliDirs,
    scripts: Object.fromEntries(VENDORS.flatMap((v) => (process.env[`HACKMAC_INSTALL_SCRIPT_${v.toUpperCase()}`] ? [[v, process.env[`HACKMAC_INSTALL_SCRIPT_${v.toUpperCase()}`]!]] : []))),
    log: (v, text) => accountsLog(`install-${v}`, text),
  });

  const detect = async (): Promise<Map<string, VendorView>> => {
    const entries = await Promise.all(
      accounts.list().map(async (a) => {
        try {
          const r = await cliStatus(a.vendor, accounts.env(a.id), { bin: binFor, run });
          return [a.id, { ...(r.status ?? NONE), installed: r.installed }] as const;
        } catch (err) {
          appLog.warn('studio', `${a.id} 상태 확인 실패: ${describeError(err)}`);
          return [a.id, NONE] as const;
        }
      }),
    );
    statuses = new Map(entries);
    appLog.info('studio', `엔진 감지: ${accounts.list().map((a) => { const s = statuses!.get(a.id)!; return `${a.id}=${s.installed ? (s.loggedIn ? '로그인' : '설치만') : '없음'}`; }).join(', ')}`);
    return statuses;
  };

  const view = async (refresh: boolean): Promise<AccountsView> => {
    const st = refresh || !statuses ? await detect() : statuses;
    // 쓰던 계정이 로그아웃됐는데 같은 회사에 로그인된 다른 계정이 있으면 그쪽으로 옮긴다(새 앱 만들기가 막히지 않게)
    for (const v of VENDORS) {
      const cur = accounts.active(v);
      if (!st.get(cur.id)?.loggedIn) {
        const other = accounts.list(v).find((a) => st.get(a.id)?.loggedIn);
        if (other) {
          appLog.info('studio', `${cur.id}이(가) 로그아웃돼 ${other.id}로 옮김`);
          accounts.setActive(other.id);
        }
      }
    }
    const active = (v: Vendor): VendorView => st.get(accounts.active(v).id) ?? NONE;
    const vendors = { claude: active('claude'), codex: active('codex') } as Record<Vendor, VendorView>;
    const seen = new Map<string, string>();
    const list: AccountView[] = accounts.list().map((a) => {
      const s = st.get(a.id) ?? NONE;
      const key = s.identity ? `${a.vendor}|${s.identity}` : null;
      const dup = key ? seen.get(key) ?? null : null;
      if (key && !dup) seen.set(key, a.id);
      return { ...s, id: a.id, vendor: a.vendor, label: a.label, isDefault: a.configDir === null, active: accounts.activeId(a.vendor) === a.id, duplicateOf: dup };
    });
    const saved = platform.settings.get().engine;
    const choice = chooseEngine(vendors, saved);
    // 하나뿐이거나 저장된 쪽이 로그아웃돼 남은 쪽을 쓰게 되면 그 선택을 저장한다(계획서 6.1: 묻지 않고 쓴다)
    if (choice.kind === 'use' && choice.vendor !== saved) platform.settings.update({ engine: choice.vendor });
    return { vendors, accounts: list, choice, engine: choice.kind === 'use' ? choice.vendor : null };
  };

  /** 그 계정으로 CLI를 쓸 수 있으면 실행 정보. 환경에는 그 계정의 설정 폴더가 들어간다 */
  const engineFor = (v: Vendor, accountId: string) => {
    const a = accounts.get(accountId);
    if (!a || a.vendor !== v || !statuses?.get(accountId)?.loggedIn) return null;
    const bin = binFor(v);
    return bin ? { bin, env: envFor(bin, accounts.env(accountId)) } : null;
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
        const v = order.find((x) => engineFor(x, accounts.activeId(x)));
        if (!v) return null;
        const eng = engineFor(v, accounts.activeId(v))!;
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
      return saved && statuses?.get(accounts.activeId(saved))?.loggedIn ? saved : null;
    },
    activeAccount: (v) => accounts.activeId(v),
    accountLabel: (id) => accounts.get(id)?.label ?? '삭제된 계정',
    engineFor,
    copySession: (vendor, fromId, toId, session) => {
      const from = accounts.get(fromId);
      const to = accounts.get(toId);
      if (!from || !to) return { ok: false, detail: '계정을 찾을 수 없어요' };
      const r = copySession(vendor, configDirOf(from), configDirOf(to), session);
      appLog.info('studio', `세션 복사 ${fromId} → ${toId}: ${r.ok ? r.copied.join(', ') : r.detail}`);
      return r.ok ? { ok: true } : { ok: false, detail: r.detail };
    },
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
  // 같은 회사 계정 추가·전환·이름 바꾸기·삭제(수동). 로그인은 그 계정의 설정 폴더 안에서 공식 CLI가 한다
  const changed = async (): Promise<AccountsView> => {
    const a = await view(true);
    broadcast('accounts:changed', a);
    return a;
  };
  ipcMain.handle('accounts:add', async (_e, v: Vendor, label?: string) => {
    if (!VENDORS.includes(v)) throw new Error(`모르는 엔진: ${v}`);
    const r = accounts.add(v, label);
    appLog.info('studio', `계정 추가: ${r.ok ? r.account.id : r.error}`);
    return r.ok ? { ok: true as const, id: r.account.id, view: await changed() } : { ok: false as const, error: r.error };
  });
  ipcMain.handle('accounts:setActive', async (_e, id: string) => {
    if (!accounts.setActive(String(id))) return { ok: false as const, error: '없는 계정이에요' };
    appLog.info('studio', `쓰는 계정 전환: ${id}`);
    return { ok: true as const, view: await changed() };
  });
  ipcMain.handle('accounts:rename', async (_e, id: string, label: string) =>
    accounts.rename(String(id), String(label)) ? { ok: true as const, view: await changed() } : { ok: false as const, error: '이름을 바꿀 수 없어요' });
  ipcMain.handle('accounts:remove', async (_e, id: string) => {
    logins.cancel(String(id));
    const ok = accounts.remove(String(id));
    appLog.info('studio', `계정 삭제: ${id} ${ok ? '' : '(기본 계정이거나 없음)'}`);
    return ok ? { ok: true as const, view: await changed() } : { ok: false as const, error: '기본 계정은 지울 수 없어요' };
  });
  ipcMain.handle('login:start', (_e, accountId: string): LoginView => {
    const a = accounts.get(String(accountId));
    if (!a) return { state: 'failed', url: null, needsCode: false, output: '없는 계정이에요' };
    // CLI가 브라우저를 직접 연다. 안 열렸을 때만 화면의 주소 버튼을 누른다
    return logins.start(a.id, a.vendor, accounts.env(a.id), (ok) => {
      appLog.info('studio', `${a.id} 로그인 ${ok ? '성공' : '실패'}`);
      void changed();
    });
  });
  ipcMain.handle('login:state', (_e, id: string) => logins.state(String(id)));
  ipcMain.handle('install:start', (_e, v: Vendor): InstallView => {
    if (!VENDORS.includes(v)) throw new Error(`모르는 엔진: ${v}`);
    return installs.start(v, (ok) => {
      appLog.info('studio', `${v} 설치 ${ok ? '성공' : '실패'}`);
      void changed();
    });
  });
  ipcMain.handle('install:state', (_e, v: Vendor) => installs.state(v));
  ipcMain.handle('login:submit', (_e, id: string, code: string) => logins.submit(String(id), String(code)));
  ipcMain.handle('login:cancel', (_e, id: string) => logins.cancel(String(id)));
  ipcMain.handle('thread:setAccount', (_e, threadId: string, accountId: string) => chats.moveAccount(String(threadId), String(accountId)));
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
