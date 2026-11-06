import { describe, expect, it } from 'vitest';
import { assign, fillHotkeys, freeCount, move, release, RESERVED, SLOT_POOL } from './slots.ts';

describe('slots', () => {
  it('예약 자리는 목록 안에 있고 앱이 받을 수 없다', () => {
    for (const s of Object.values(RESERVED)) expect(SLOT_POOL).toContain(s);
    expect(freeCount({})).toBe(SLOT_POOL.length - Object.keys(RESERVED).length);
  });

  it('빈 자리를 순서대로 준다', () => {
    const a = assign({}, 'a.x', ['one', 'two'])!;
    expect(a).toEqual({ 'a.x/one': 'Alt+1', 'a.x/two': 'Alt+2' });
  });

  it('이미 배정된 키는 건너뛰고 다른 앱과 겹치지 않는다', () => {
    const a = assign({}, 'a.x', ['one'])!;
    const b = assign(a, 'b.y', ['one'])!;
    expect(b['b.y/one']).toBe('Alt+2');
    expect(assign(b, 'a.x', ['one'])).toEqual(b);
  });

  it('전에 쓰던 자리가 비어 있으면 그 자리를 다시 준다', () => {
    let a = assign({}, 'a.x', ['one'])!;
    a = assign(a, 'b.y', ['one'])!;
    const previous = { ...a };
    a = release(a, 'a.x');
    a = assign(a, 'c.z', ['one'])!; // Alt+1을 가져감
    a = release(a, 'c.z');
    const back = assign(a, 'a.x', ['one'], previous)!;
    expect(back['a.x/one']).toBe('Alt+1');
  });

  it('자리가 모자라면 null이고 아무것도 바뀌지 않는다', () => {
    const keys = Array.from({ length: freeCount({}) }, (_, i) => `k${i}`);
    const full = assign({}, 'a.x', keys)!;
    expect(freeCount(full)).toBe(0);
    expect(assign(full, 'b.y', ['one'])).toBeNull();
  });

  it('move: 목록 안의 빈 자리로만 옮긴다', () => {
    const a = assign({}, 'a.x', ['one', 'two'])!;
    expect(move(a, 'a.x/one', 'Alt+5')).toMatchObject({ 'a.x/one': 'Alt+5' });
    expect(move(a, 'a.x/one', 'Alt+2')).toBeNull(); // two가 씀
    expect(move(a, 'a.x/one', RESERVED['hackmac/open'])).toBeNull();
    expect(move(a, 'a.x/one', 'Cmd+K')).toBeNull();
    expect(move(a, 'nope/one', 'Alt+5')).toBeNull();
  });

  it('fillHotkeys: 카피의 자리표시를 채운다', () => {
    const a = assign({}, 'a.x', ['register'])!;
    expect(fillHotkeys("'업무 등록'({hotkey:register})을 누르세요", a, 'a.x')).toBe("'업무 등록'(Alt+1)을 누르세요");
    expect(fillHotkeys('{hotkey:none}', a, 'a.x')).toBe('단축키');
  });
});
