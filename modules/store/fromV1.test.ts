import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../../shared/manifest.ts';
import { convertV1, writeV2Package } from './fromV1.ts';
import { readPackage, Store } from './store.ts';

// 실제 v1 번들 서비스로 시험한다: 변환기의 목적이 바로 이 폴더라서
const GTD = join(process.cwd(), 'resources', 'services', 'gtd-reminders');

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-v1-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('convertV1 (gtd-reminders)', () => {
  const { manifest, scripts } = convertV1(GTD, '2.0.0');

  it('검증기를 통과하는 v2 선언을 만든다', () => {
    const r = parseManifest(manifest);
    expect(r.ok, JSON.stringify((r as { errors?: string[] }).errors)).toBe(true);
  });

  it('id에 작성자 hackmac이 붙고 스크립트마다 hotkey 트리거가 하나씩', () => {
    expect(manifest.id).toBe('hackmac.gtd-reminders');
    expect(manifest.triggers).toHaveLength(scripts.length);
    expect(manifest.triggers.map((t) => (t as { key: string }).key)).toEqual(['register', 'start', 'complete', 'status', 'share', 'new-project', 'normalize', 'delete']);
  });

  it('키 조합은 선언 어디에도 남지 않고 {hotkey:<key>}로 바뀐다', () => {
    const text = JSON.stringify(manifest);
    expect(text).not.toMatch(/Alt\+/);
    expect(manifest.usage[0]).toContain("'업무 등록'({hotkey:register})");
    expect(manifest.usage.at(-1)).toContain('{hotkey:normalize}');
    expect(manifest.usage.at(-1)).toContain('{hotkey:new-project}');
  });

  it('스크립트가 제어하는 앱을 automation 권한으로 올린다', () => {
    expect(manifest.permissions.automation).toContain('Reminders');
    expect(manifest.permissions.automation).not.toContain('System Events');
  });
});

describe('writeV2Package → Store.install', () => {
  it('변환한 패키지가 보관소에 그대로 설치된다', () => {
    const pkg = join(tmp, 'pkg');
    writeV2Package(GTD, pkg, '2.0.0');
    expect(readPackage(pkg).ok).toBe(true);
    const store = new Store(join(tmp, 'apps'), { popup: 1 });
    expect(store.install(pkg)).toMatchObject({ ok: true, id: 'hackmac.gtd-reminders', version: 1 });
  });
});
