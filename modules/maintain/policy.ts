/**
 * 유지보수 정책(계획서 11.4 한도 보호). 사용자 한도를 헛되이 쓰지 않으려고 부르는 때를 코드가 정한다. 값은 모두 [시작값].
 */
export interface PolicyConfig {
  /** 조용한 시간(시). from 이상이거나 to 미만이면 조용하다(밤을 넘기는 구간도 된다) */
  quietFrom: number;
  quietTo: number;
  /** 같은 앱을 하루(24시간)에 팀에 맡기는 횟수 상한 */
  dailyCap: number;
  /** 같은 앱·같은 외부 원인을 다시 안내하기까지 */
  adviceCooldownMs: number;
  /** 코드 원인 실패가 이만큼 되풀이돼야 팀을 부른다(한 번은 우연일 수 있다). 상주 앱이 포기했을 때는 바로 */
  failuresToCall: number;
  /** 팀이 못 고친 뒤, 같은 앱을 다시 맡기기까지(바로 다시 해도 같은 결과라 한도만 쓴다) */
  retryAfterFailMs: number;
}

export const DEFAULT_POLICY: PolicyConfig = { quietFrom: 23, quietTo: 7, dailyCap: 3, adviceCooldownMs: 6 * 3_600_000, failuresToCall: 2, retryAfterFailMs: 3_600_000 };

export const isQuiet = (now: Date, c: PolicyConfig = DEFAULT_POLICY): boolean => {
  const h = now.getHours();
  return c.quietFrom > c.quietTo ? h >= c.quietFrom || h < c.quietTo : h >= c.quietFrom && h < c.quietTo;
};

/** go: 지금 부른다 · cap: 오늘은 그만(버린다) · quiet/busy: 나중에(큐에 둔다) */
export type TeamDecision = 'go' | 'cap' | 'quiet' | 'busy';

export const teamDecision = (a: { now: Date; calledLast24h: number; userBusy: boolean }, c: PolicyConfig = DEFAULT_POLICY): TeamDecision => {
  if (a.calledLast24h >= c.dailyCap) return 'cap';
  if (isQuiet(a.now, c)) return 'quiet';
  // 사용자가 작업실에서 엔진을 쓰는 중이면 미룬다(같은 구독 한도를 같이 쓴다)
  if (a.userBusy) return 'busy';
  return 'go';
};
