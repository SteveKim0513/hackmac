import { describe, expect, it } from 'vitest';
import { cronMatches, parseCron } from './cron.ts';

const at = (s: string): Date => new Date(s);

describe('cron', () => {
  it('별·숫자·범위·목록·스텝', () => {
    const c = parseCron('0 16 * * 1-5')!;
    expect(cronMatches(c, at('2026-11-06T16:00:00'))).toBe(true); // 금
    expect(cronMatches(c, at('2026-11-06T16:01:00'))).toBe(false);
    expect(cronMatches(c, at('2026-11-07T16:00:00'))).toBe(false); // 토
    expect(cronMatches(parseCron('*/15 9,18 1 * *')!, at('2026-11-01T18:45:00'))).toBe(true);
    expect(cronMatches(parseCron('*/15 9,18 1 * *')!, at('2026-11-02T18:45:00'))).toBe(false);
    expect(cronMatches(parseCron('0 0 * * 7')!, at('2026-11-08T00:00:00'))).toBe(true); // 일요일=7
  });
  it('틀린 식은 null', () => {
    for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '5-1 * * * *', 'a * * * *', '*/0 * * * *']) expect(parseCron(bad), bad).toBeNull();
  });
});
