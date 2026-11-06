import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalize, Settings } from './settings.ts';

let tmp: string;
let path: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'hackmac-settings-')); path = join(tmp, 'v2', 'settings.json'); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('normalize', () => {
  it('객체가 아니면 기본값', () => {
    expect(normalize(null)).toEqual(DEFAULT_SETTINGS);
  });
  it('칸마다 따져 읽고 모르는 칸과 깨진 값은 버린다', () => {
    expect(normalize({ enabled: ['a.x', 3], hotkeys: { 'a.x/k': 'Alt+1', bad: 1 }, appSettings: { 'a.x': { n: '1', m: 2 } }, theme: 'neon', engine: 'codex', autoApplyFixes: 'yes', extra: true })).toEqual({
      schema: 1, enabled: ['a.x'], hotkeys: { 'a.x/k': 'Alt+1' }, hotkeysPrevious: {}, appSettings: { 'a.x': { n: '1' } }, theme: 'system', engine: 'codex', autoApplyFixes: false,
    });
  });
});

describe('Settings', () => {
  it('없으면 기본값으로 시작하고 폴더를 만든다', () => {
    const s = new Settings(path);
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(existsSync(path)).toBe(false);
  });
  it('update는 합쳐서 파일에 쓰고 다시 읽힌다', () => {
    const s = new Settings(path);
    s.update({ enabled: ['a.x'] });
    s.update({ theme: 'dark' });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ enabled: ['a.x'], theme: 'dark' });
    expect(new Settings(path).get()).toMatchObject({ enabled: ['a.x'], theme: 'dark' });
    expect(readdirSync(join(tmp, 'v2')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
  it('깨진 파일은 broken/에 사본을 두고 기본값으로 시작한다', () => {
    new Settings(path).update({ enabled: ['a.x'] });
    writeFileSync(path, '{broken');
    const s = new Settings(path);
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(s.brokenCopy).toMatch(/broken\/settings\.json\.\d+$/);
    expect(readFileSync(s.brokenCopy!, 'utf8')).toBe('{broken');
  });
});
