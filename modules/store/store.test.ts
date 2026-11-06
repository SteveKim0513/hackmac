import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPackage, Store } from './store.ts';

const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 1,
  id: 'jiho.hello',
  version: '1',
  author: { name: 'jiho', signature: null },
  hackmac: { min: '2.0.0' },
  name: '인사',
  icon: '👋',
  tagline: '인사해요',
  usage: ['{hotkey:hi}를 누르세요.'],
  triggers: [{ kind: 'hotkey', script: 'scripts/hi.sh', key: 'hi', name: '인사', description: '인사합니다.' }],
  capabilities: { popup: '>=1' },
  permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false },
  settings: [],
  secrets: [],
  references: [],
  ...over,
});

let tmp: string;
const makePkg = (name: string, over: Record<string, unknown> = {}, scripts = ['scripts/hi.sh']): string => {
  const dir = join(tmp, 'pkgs', name);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest(over)));
  for (const s of scripts) writeFileSync(join(dir, s), '#!/bin/zsh\necho hi\n');
  return dir;
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-store-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('readPackage', () => {
  it('manifest가 없으면 읽을 수 없다고 한다', () => {
    const r = readPackage(tmp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/manifest\.json을 읽을 수 없음/);
  });
  it('트리거가 가리키는 스크립트가 없으면 실패', () => {
    const r = readPackage(makePkg('a', {}, []));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual(expect.stringMatching(/scripts\/hi\.sh' 파일이 패키지에 없음/));
  });
  it('node_modules가 있으면 실패', () => {
    const dir = makePkg('a');
    mkdirSync(join(dir, 'node_modules'));
    const r = readPackage(dir);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual(expect.stringMatching(/node_modules/));
  });
});

describe('Store', () => {
  it('설치하면 v1과 current가 생기고 목록에 보인다', () => {
    const store = new Store(join(tmp, 'apps'), { popup: 1 });
    const r = store.install(makePkg('a'));
    expect(r).toMatchObject({ ok: true, id: 'jiho.hello', version: 1 });
    expect(store.list()).toEqual([expect.objectContaining({ id: 'jiho.hello', current: 1, versions: [1] })]);
    expect(readFileSync(join(tmp, 'apps', 'jiho.hello', 'current'), 'utf8')).toBe('1\n');
    expect(store.currentDir('jiho.hello')).toBe(join(tmp, 'apps', 'jiho.hello', 'v1'));
  });

  it('능력이 모자라면 설치하지 않고 무엇이 모자란지 말한다', () => {
    const store = new Store(join(tmp, 'apps'), { popup: 1 });
    const r = store.install(makePkg('a', { capabilities: { popup: '>=2', ai: '>=1' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        expect.stringMatching(/'popup' >=2 필요 \(가진 것 1\)/),
        expect.stringMatching(/'ai' >=1 필요 \(없음\)/),
      ]);
    }
    expect(store.list()).toEqual([]);
  });

  it('같은 id를 다시 설치하면 다음 버전이 되고 data/는 남는다', () => {
    const store = new Store(join(tmp, 'apps'), { popup: 1 });
    store.install(makePkg('a'));
    writeFileSync(join(store.dataDir('jiho.hello'), 'state.json'), '{"n":1}');
    const r = store.install(makePkg('b', { version: '2' }));
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect(store.get('jiho.hello')).toMatchObject({ current: 2, versions: [1, 2] });
    expect(readFileSync(join(store.dataDir('jiho.hello'), 'state.json'), 'utf8')).toBe('{"n":1}');
  });

  it('이전 버전으로 돌아갈 수 있고 없는 버전은 거부', () => {
    const store = new Store(join(tmp, 'apps'), { popup: 1 });
    store.install(makePkg('a'));
    store.install(makePkg('b'));
    expect(store.switchTo('jiho.hello', 1)).toBe(true);
    expect(store.get('jiho.hello')?.current).toBe(1);
    expect(store.switchTo('jiho.hello', 9)).toBe(false);
    expect(store.get('jiho.hello')?.current).toBe(1);
  });

  it('current가 깨져 있으면 null로 보고하되 목록에서 빼지 않는다', () => {
    const store = new Store(join(tmp, 'apps'), { popup: 1 });
    store.install(makePkg('a'));
    writeFileSync(join(tmp, 'apps', 'jiho.hello', 'current'), 'garbage');
    expect(store.get('jiho.hello')).toMatchObject({ current: null, versions: [1] });
    expect(store.currentDir('jiho.hello')).toBeNull();
  });

  it('지우기: keepData면 data/만 남는다', () => {
    const store = new Store(join(tmp, 'apps'), { popup: 1 });
    store.install(makePkg('a'));
    writeFileSync(join(store.dataDir('jiho.hello'), 'x'), '1');
    store.remove('jiho.hello', { keepData: true });
    expect(store.get('jiho.hello')).toMatchObject({ current: null, versions: [] });
    expect(readFileSync(join(tmp, 'apps', 'jiho.hello', 'data', 'x'), 'utf8')).toBe('1');
    store.remove('jiho.hello', { keepData: false });
    expect(store.get('jiho.hello')).toBeNull();
  });
});
