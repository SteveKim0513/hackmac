/**
 * 대화 엔진의 공통 모양. 화면·제작 단계는 이것만 보고, 어느 회사 CLI인지 모른다.
 * Claude(`claude -p --input-format stream-json`)와 Codex(`codex app-server` JSON-RPC)의 차이는 어댑터가 흡수한다.
 */
import type { Vendor } from '../account/cli.ts';

export type ConversationEvent =
  /** 세션이 열렸다. session: Claude 세션 번호 / Codex thread 번호. 이어 열 때 resume에 넣는다 */
  | { kind: 'ready'; session: string }
  /** 글 조각. phase: answer(사용자에게 하는 말) / commentary(일하면서 남기는 중간 설명, Codex만) */
  | { kind: 'text'; delta: string; phase: 'answer' | 'commentary' }
  /** 도구를 쓰기 시작했다(이름만. 진행 화면이 "명령 실행 중"을 보이는 데 쓴다) */
  | { kind: 'tool'; name: string }
  /** 턴 하나가 끝났다. text: 이 턴의 최종 답. error: 실패 이유 */
  | { kind: 'turnEnd'; ok: boolean; text: string; error: string | null; interrupted: boolean }
  /** 구독 한도. window: five_hour / seven_day / 그 밖의 이름. used: 0~1(모르면 null). blocked: 지금 막혔다 */
  | { kind: 'limit'; window: string; used: number | null; resetsAt: number | null; blocked: boolean }
  /** 엔진 프로세스가 끝났다. expected: stop()으로 끈 것 */
  | { kind: 'exit'; code: number | null; signal: string | null; expected: boolean };

export interface ConversationOptions {
  /** CLI 실행 파일(절대경로) */
  bin: string;
  /** 엔진이 일하는 폴더(앱 작업 폴더). Codex 샌드박스는 여기와 /tmp 밖 쓰기를 막는다 */
  cwd: string;
  /** 자식 환경(cleanEnv + accountEnv를 거친 것) */
  env: Record<string, string>;
  /** 이어 열 세션 */
  resume?: string;
  /** 대화 내내 붙는 지시(Claude: --append-system-prompt, Codex: developerInstructions) */
  instructions?: string;
  /** Claude: 묻지 않고 허용할 도구(--allowedTools). 그 밖은 dontAsk로 거부된다. Codex는 샌드박스로 막으므로 쓰지 않는다 */
  allowedTools?: string[];
  /** bin 바로 뒤에 붙는 인자(시험에서 가짜 CLI 스크립트 경로를 넣는다) */
  prefixArgs?: string[];
  /** 고정 플래그 뒤에 붙는 인자 */
  extraArgs?: string[];
}

export interface Conversation {
  readonly vendor: Vendor;
  /** 열린 세션 번호(ready 전에는 resume 값 또는 null) */
  readonly session: string | null;
  /** 턴이 돌고 있다 */
  readonly busy: boolean;
  /** 프로세스가 떠 있다 */
  readonly alive: boolean;
  /** 엔진이 표준 오류로 낸 마지막 글(실패 원인 판정에 쓴다) */
  readonly lastError: string;
  start(): Promise<void>;
  /** 쉬고 있으면 바로 보내고, 일하는 중이면 줄 세웠다가 턴이 끝나면 보낸다 */
  send(text: string): void;
  /** 지금 턴을 멈춘다. 줄 선 글은 버린다 */
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  onEvent(cb: (e: ConversationEvent) => void): () => void;
}
