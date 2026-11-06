/**
 * 어느 엔진으로 일할지 고른다(계획서 6.1).
 *   로그인 0개 → 로그인 화면. 1개 → 묻지 않고 그걸 쓴다. 2개 → 저장된 선택이 있으면 그것, 없으면 한 번 묻는다.
 * 저장된 엔진이 로그아웃됐으면 남은 쪽을 쓰고 그 사실을 알린다(조용히 바꾸지 않는다).
 */
import type { Vendor } from './cli.ts';

export interface VendorState {
  installed: boolean;
  loggedIn: boolean;
}

export type EngineChoice =
  | { kind: 'use'; vendor: Vendor; switchedFrom: Vendor | null }
  | { kind: 'ask'; options: Vendor[] }
  /** 로그인한 CLI가 없다. installed: 깔려 있는 CLI(없으면 준비 단계가 먼저 깐다) */
  | { kind: 'login'; installed: Vendor[] };

export const chooseEngine = (states: Record<Vendor, VendorState>, saved: Vendor | null): EngineChoice => {
  const vendors = Object.keys(states) as Vendor[];
  const ready = vendors.filter((v) => states[v].installed && states[v].loggedIn);
  if (ready.length === 0) return { kind: 'login', installed: vendors.filter((v) => states[v].installed) };
  if (saved && ready.includes(saved)) return { kind: 'use', vendor: saved, switchedFrom: null };
  if (ready.length === 1) return { kind: 'use', vendor: ready[0], switchedFrom: saved && saved !== ready[0] ? saved : null };
  return { kind: 'ask', options: ready };
};
