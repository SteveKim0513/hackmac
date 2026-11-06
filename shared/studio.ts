/** 작업실(계정·스레드·채팅) 화면과 메인 프로세스가 주고받는 모양. 타입만 — 렌더러 번들에 모듈 코드가 들어가지 않는다 */
import type { EngineChoice } from '../modules/account/choose';
import type { CliStatus, Vendor } from '../modules/account/cli';
import type { LoginView } from '../modules/account/login';
import type { ChatEvent, SendResult } from '../modules/studio/chat';
import type { Message, ThreadMeta } from '../modules/thread/thread';

export type { ChatEvent, CliStatus, EngineChoice, LoginView, Message, SendResult, ThreadMeta, Vendor };

export interface VendorView extends CliStatus { installed: boolean }
export interface AccountsView { vendors: Record<Vendor, VendorView>; choice: EngineChoice; engine: Vendor | null }
export interface ThreadView { meta: ThreadMeta; messages: Message[]; busy: boolean }

export const VENDOR_LABEL: Record<Vendor, string> = { claude: 'Claude', codex: 'ChatGPT' };
