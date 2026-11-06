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
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chooseEngine } from '../modules/account/choose';
import { cliStatus, envFor, resolveBin, run, searchDirs, VENDORS, type CliStatus, type Vendor } from '../modules/account/cli';
import { createLogins, fileLogger, type LoginView } from '../modules/account/login';
import type { Platform } from '../modules/platform/platform';
import { Chats, type ChatEvent } from '../modules/studio/chat';
import { ThreadStore, type ThreadMeta } from '../modules/thread/thread';
import type { AccountsView, ThreadView, VendorView } from '../shared/studio';
import { appLog, describeError } from './log';

/**
 * 3단계(계정·대화)의 작업실 지시. 아직 앱을 만들지 않는다: 도구를 허용하지 않고(Claude dontAsk + allowedTools 없음),
 * 요구사항을 묻고 정리하는 데까지만 한다. 4단계(제작)에서 맥 전문 에이전트 지시로 바뀐다.
 */
export const STUDIO_INSTRUCTIONS = [
  '너는 HackMac의 앱 설계 도우미다. HackMac은 macOS에서 단축키·메뉴바·스케줄로 도는 작은 자동화 앱을 만들어 켜고 끄는 제품이다.',
  '사용자가 맥에서 하고 싶은 일을 들으면, 꼭 필요한 것만 한 번에 하나씩 물어서 요구사항을 번호 붙은 목록으로 정리한다.',
  '지금 단계에서는 코드를 쓰거나 명령을 실행하거나 파일을 만들지 않는다. 대화로만 정리한다.',
  '한국어로, 짧고 쉬운 말로 답한다. 전문 용어는 꼭 필요할 때만 쓰고 바로 풀어 말한다.',
  // 채팅 화면은 글을 그대로 보여 준다(마크다운을 그리지 않는다). 실제로 Claude가 **굵게**를 써서 별표가 그대로 보였다
  '채팅 화면은 마크다운을 그리지 않는다. **, #, ` 같은 기호를 쓰지 말고, 목록은 줄마다 "- "나 "1. "로 시작한다.',
].join('\n');

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

  const chats = new Chats({
    threads,
    defaultVendor: () => {
      const saved = platform.settings.get().engine;
      return saved && vendors?.[saved]?.loggedIn ? saved : null;
    },
    engineFor,
    instructions: STUDIO_INSTRUCTIONS,
    allowedTools: [],
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

  void view(true).catch((err) => appLog.error('studio', `엔진 감지 실패: ${describeError(err)}`));

  return { stop: () => chats.stopAll() };
}
