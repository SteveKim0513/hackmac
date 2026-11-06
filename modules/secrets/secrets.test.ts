import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SecretStore, type SecretCrypto } from './secrets.ts';

// 가짜 암호: 글자를 뒤집고 접두어를 붙인다(평문과 달라야 한다는 것만 확인)
const fake = (available = true): SecretCrypto => ({
  available: () => available,
  encrypt: (p) => Buffer.from(`enc:${[...p].reverse().join('')}`),
  decrypt: (c) => {
    const s = c.toString();
    if (!s.startsWith('enc:')) throw new Error('bad');
    return [...s.slice(4)].reverse().join('');
  },
});

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hackmac-secrets-'));
  file = join(dir, 'secrets.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('SecretStore', () => {
  it('저장한 값은 파일에 평문으로 없고, 읽으면 돌아온다', () => {
    const s = new SecretStore(file, fake());
    expect(s.set('my.app', 'api-key', 'sk-SECRET-123')).toEqual({ ok: true });
    expect(readFileSync(file, 'utf8')).not.toContain('SECRET');
    expect(s.values('my.app')).toEqual({ 'api-key': 'sk-SECRET-123' });
    expect(s.has('my.app', 'api-key')).toBe(true);
  });
  it('다시 열어도 남는다', () => {
    new SecretStore(file, fake()).set('my.app', 'k', 'v');
    expect(new SecretStore(file, fake()).values('my.app')).toEqual({ k: 'v' });
  });
  it('지우기·앱 지우기', () => {
    const s = new SecretStore(file, fake());
    s.set('a.x', 'k1', 'v1');
    s.set('a.x', 'k2', 'v2');
    s.clear('a.x', 'k1');
    expect(s.values('a.x')).toEqual({ k2: 'v2' });
    s.clearApp('a.x');
    expect(s.has('a.x', 'k2')).toBe(false);
  });
  it('암호화를 쓸 수 없으면 평문으로 저장하지 않고 거절한다', () => {
    const s = new SecretStore(file, fake(false));
    const r = s.set('a.x', 'k', 'v');
    expect(r.ok).toBe(false);
    expect(s.has('a.x', 'k')).toBe(false);
    expect(s.values('a.x')).toEqual({});
  });
  it('복호화할 수 없는 항목은 건너뛴다', () => {
    new SecretStore(file, fake()).set('a.x', 'k', 'v');
    const other: SecretCrypto = { available: () => true, encrypt: (p) => Buffer.from(p), decrypt: () => { throw new Error('다른 키체인'); } };
    expect(new SecretStore(file, other).values('a.x')).toEqual({});
  });
  it('깨진 파일은 빈 상태로 시작한다', () => {
    writeFileSync(file, '{깨짐');
    expect(new SecretStore(file, fake()).values('a.x')).toEqual({});
  });
});
