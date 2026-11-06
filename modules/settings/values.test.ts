import { describe, expect, it } from 'vitest';
import type { SettingDecl } from '../../shared/manifest.ts';
import { cronAt, defaultValue, effectiveValue, normalizeValue, toField } from './values.ts';

const d = (over: Partial<SettingDecl>): SettingDecl => ({ key: 'k', label: '값', type: 'string', ...over });

describe('normalizeValue', () => {
  it('number: 숫자만', () => {
    expect(normalizeValue(d({ type: 'number' }), ' 12.5 ')).toEqual({ ok: true, value: '12.5' });
    expect(normalizeValue(d({ type: 'number' }), 'abc').ok).toBe(false);
    expect(normalizeValue(d({ type: 'number' }), '').ok).toBe(false);
  });
  it('boolean: true/false만', () => {
    expect(normalizeValue(d({ type: 'boolean' }), 'true')).toEqual({ ok: true, value: 'true' });
    expect(normalizeValue(d({ type: 'boolean' }), 'yes').ok).toBe(false);
  });
  it('choice: 보기 안에서만', () => {
    const c = d({ type: 'choice', options: ['a', 'b'] });
    expect(normalizeValue(c, 'a').ok).toBe(true);
    expect(normalizeValue(c, 'z').ok).toBe(false);
  });
  it('time: 24시간 HH:MM, 한 자리 시는 두 자리로', () => {
    expect(normalizeValue(d({ type: 'time' }), '9:05')).toEqual({ ok: true, value: '09:05' });
    expect(normalizeValue(d({ type: 'time' }), '23:59')).toEqual({ ok: true, value: '23:59' });
    for (const bad of ['24:00', '9:60', '9', '오전 9시', '']) expect(normalizeValue(d({ type: 'time' }), bad).ok, bad).toBe(false);
  });
  it('list: 줄·쉼표로 나누거나 JSON 배열, 빈 항목은 버린다', () => {
    const l = d({ type: 'list' });
    expect(normalizeValue(l, 'AAPL\n MSFT ,\n\nNVDA')).toEqual({ ok: true, value: '["AAPL","MSFT","NVDA"]' });
    expect(normalizeValue(l, '["a","b"]')).toEqual({ ok: true, value: '["a","b"]' });
    expect(normalizeValue(l, '[1,2]').ok).toBe(false);
    expect(normalizeValue(l, '[깨짐').ok).toBe(false);
  });
  it('string: 그대로(앞뒤 공백도)', () => {
    expect(normalizeValue(d({}), ' a ')).toEqual({ ok: true, value: ' a ' });
  });
});

describe('기본값과 현재 값', () => {
  it('저장값이 우선, 없거나 빈 값이면 기본값, 둘 다 없으면 undefined', () => {
    const x = d({ type: 'number', default: 30 });
    expect(effectiveValue(x, { k: '10' })).toBe('10');
    expect(effectiveValue(x, { k: '' })).toBe('30');
    expect(effectiveValue(x, undefined)).toBe('30');
    expect(effectiveValue(d({}), undefined)).toBeUndefined();
  });
  it('목록 기본값은 JSON 문자열', () => {
    expect(defaultValue(d({ type: 'list', default: ['a'] }))).toBe('["a"]');
    expect(defaultValue(d({ type: 'boolean', default: true }))).toBe('true');
  });
  it('화면 칸: 바꾼 값이 있을 때만 changed', () => {
    const x = d({ type: 'time', default: '09:00' });
    expect(toField(x, undefined)).toMatchObject({ value: '09:00', default: '09:00', changed: false });
    expect(toField(x, { k: '10:30' })).toMatchObject({ value: '10:30', changed: true });
  });
});

describe('cronAt', () => {
  it('매일 그 시각', () => {
    expect(cronAt('09:00')).toBe('0 9 * * *');
    expect(cronAt('18:05')).toBe('5 18 * * *');
    expect(cronAt('9:5')).toBeNull();
  });
});
