/**
 * 단축키 자리(slot) 배정. 앱은 키 조합을 고르지 않고 자리를 요청하며, HackMac이 빈 자리를 준다
 * (docs/hackmac-v2-manifest.md 3.3.1). 순수 자료 구조라 저장은 호출자가 한다.
 *
 * 자리 목록은 시작값이다: Alt+1..0, Alt+Shift+1..0. 앞 두 자리는 HackMac 몫(치트시트, HackMac 열기).
 */

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
export const SLOT_POOL: readonly string[] = [...DIGITS.map((d) => `Alt+${d}`), ...DIGITS.map((d) => `Alt+Shift+${d}`)];
export const RESERVED: Readonly<Record<string, string>> = { 'hackmac/cheatsheet': 'Alt+Shift+0', 'hackmac/open': 'Alt+Shift+9' };

/** `<app-id>/<key>` → 자리. 저장 형식 그대로 */
export type Assignments = Record<string, string>;

export const slotId = (appId: string, key: string): string => `${appId}/${key}`;

const taken = (a: Assignments): Set<string> => new Set([...Object.values(RESERVED), ...Object.values(a)]);

/** 앱의 모든 hotkey 트리거에 자리를 준다. 전에 쓰던 자리가 비어 있으면 그 자리. 모자라면 아무것도 바꾸지 않고 null */
export const assign = (a: Assignments, appId: string, keys: string[], previous: Assignments = {}): Assignments | null => {
  const next: Assignments = { ...a };
  const used = taken(next);
  const free = SLOT_POOL.filter((s) => !used.has(s));
  for (const key of keys) {
    const id = slotId(appId, key);
    if (next[id]) continue;
    const old = previous[id];
    const slot = old && !used.has(old) ? old : free.find((s) => !used.has(s));
    if (!slot) return null;
    next[id] = slot;
    used.add(slot);
  }
  return next;
};

/** 앱의 자리를 모두 돌려준다 */
export const release = (a: Assignments, appId: string): Assignments => {
  const prefix = `${appId}/`;
  return Object.fromEntries(Object.entries(a).filter(([id]) => !id.startsWith(prefix)));
};

/** 사용자가 설정에서 자리를 바꾼다. 목록 밖 자리나 이미 쓰는 자리는 거부 */
export const move = (a: Assignments, id: string, slot: string): Assignments | null => {
  if (!(id in a) || !SLOT_POOL.includes(slot)) return null;
  const used = taken(release(a, id.split('/')[0]));
  for (const [otherId, s] of Object.entries(a)) if (otherId !== id) used.add(s);
  if (used.has(slot)) return null;
  return { ...a, [id]: slot };
};

export const freeCount = (a: Assignments): number => SLOT_POOL.length - taken(a).size;

/** 카피의 `{hotkey:<key>}`를 배정된 자리로 채운다. 배정 전이면 "미배정" */
export const fillHotkeys = (text: string, a: Assignments, appId: string): string =>
  text.replace(/\{hotkey:([a-z0-9-]+)\}/g, (_, key: string) => a[slotId(appId, key)] ?? '미배정');
