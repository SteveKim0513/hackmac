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
/** 계정 하나. 같은 회사 계정을 최대 3개까지 두고 사용자가 수동으로 옮긴다(modules/account/accounts.ts) */
export interface AccountView extends VendorView {
  id: string;
  vendor: Vendor;
  label: string;
  isDefault: boolean;
  /** 그 회사에서 지금 쓰는 계정(새 앱 만들기가 이 계정으로 시작한다) */
  active: boolean;
  /** 같은 계정(메일·조직)에 두 번 로그인했으면 먼저 등록된 쪽 id. 한도를 같이 쓰므로 전환해도 소용없다 */
  duplicateOf: string | null;
}
/** vendors는 회사별로 "지금 쓰는 계정"의 상태, accounts는 모든 계정 */
export interface AccountsView { vendors: Record<Vendor, VendorView>; accounts: AccountView[]; choice: EngineChoice; engine: Vendor | null }
export interface ThreadView { meta: ThreadMeta; messages: Message[]; busy: boolean }

export const MAX_ACCOUNTS_PER_VENDOR = 3;
export const VENDOR_LABEL: Record<Vendor, string> = { claude: 'Claude', codex: 'ChatGPT' };
