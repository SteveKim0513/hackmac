/** 작업실(계정·스레드·채팅) 화면과 메인 프로세스가 주고받는 모양. 타입만 — 렌더러 번들에 모듈 코드가 들어가지 않는다 */
import type { EngineChoice } from '../modules/account/choose';
import type { CliStatus, Vendor } from '../modules/account/cli';
import type { LoginView } from '../modules/account/login';
import type { ChatEvent, SendResult } from '../modules/studio/chat';
import type { Message, ThreadMeta } from '../modules/thread/thread';
import type { BuildState, ReqStatus, Verdict } from '../modules/build/progress';
import type { InstallView } from '../modules/prepare/install';
import type { BundlePreview } from '../modules/bundle/bundle';

export type { BuildState, ChatEvent, InstallView, CliStatus, EngineChoice, LoginView, Message, ReqStatus, SendResult, ThreadMeta, Vendor, Verdict };

export type { BundlePreview };
export type BundlePick =
  | { picked: false }
  | { picked: true; file: string; result: { ok: true; preview: BundlePreview } | { ok: false; errors: string[] } };

export interface VendorView extends CliStatus { installed: boolean }
export interface AccountsView { vendors: Record<Vendor, VendorView>; choice: EngineChoice; engine: Vendor | null }
export interface ThreadView { meta: ThreadMeta; messages: Message[]; busy: boolean }

export const VENDOR_LABEL: Record<Vendor, string> = { claude: 'Claude', codex: 'ChatGPT' };
