/**
 * 꾸러미(.hackapp): 앱 패키지 폴더를 파일 하나로 묶고 풀어 읽는다(계획서 9.1). Node 기본 모듈만 쓴다.
 *
 * 형식: gzip(JSON) 한 덩어리. { format:'hackapp', version:1, id, appVersion, files:[{path, mode, size, sha256, data(base64)}], sha256 }
 *   - 외부 도구(tar·zip)를 쓰지 않는다: 받은 파일은 신뢰 경계 밖이라 풀기 규칙(경로·크기·링크)을 우리가 직접 쥔다.
 *   - 패키지(코드·선언·시험)만 들어간다. 설정값·비밀값·데이터 폴더는 애초에 보관소의 버전 폴더 밖에 있어 따라가지 않는다(9.3 규칙 2).
 *   - sha256 = 정렬한 "경로:파일해시" 줄들의 해시. 한 바이트라도 바뀌면 설치 전에 걸린다.
 * 받은 파일은 미리 보기에서 실행하지 않는다(시험 스크립트 포함). 선언 요약을 보고 사용자가 확인한 뒤에만 설치한다(9.5).
 */
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isPackagePath, missingCapabilities, type AppManifest } from '../../shared/manifest.ts';
import { readPackage } from '../store/store.ts';

export const BUNDLE_FORMAT = 'hackapp';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXT = 'hackapp';

export const LIMITS = { files: 500, bytes: 5 * 1024 * 1024, jsonBytes: 40 * 1024 * 1024 } as const;
const SKIP = new Set(['.DS_Store']);

interface FileEntry { path: string; mode: number; size: number; sha256: string; data: string }
interface BundleJson { format: string; version: number; id: string; appVersion: string; files: FileEntry[]; sha256: string }

const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const treeHash = (files: { path: string; sha256: string }[]): string =>
  sha([...files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => `${f.path}:${f.sha256}`).join('\n'));

const walk = (dir: string, base = dir): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (SKIP.has(d.name)) return [];
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p, base) : [relative(base, p)];
  });

/** 패키지 폴더 → 꾸러미 바이트. 선언이 틀렸거나 링크·크기 위반이면 throw(이 앱은 설치도 못 된다) */
export function pack(pkgDir: string): { bytes: Buffer; id: string; appVersion: string; fileName: string } {
  const read = readPackage(pkgDir);
  if (!read.ok) throw new Error(`내보낼 수 없는 앱: ${read.errors.join('; ')}`);
  const m = read.manifest;
  const paths = walk(pkgDir).sort();
  if (paths.length > LIMITS.files) throw new Error(`파일이 너무 많아요(${paths.length}개, 상한 ${LIMITS.files}개)`);
  let total = 0;
  const files: FileEntry[] = paths.map((path) => {
    const abs = join(pkgDir, path);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) throw new Error(`${path}: 심볼릭 링크는 내보낼 수 없어요`);
    const data = readFileSync(abs);
    total += data.length;
    return { path, mode: st.mode & 0o111 ? 0o755 : 0o644, size: data.length, sha256: sha(data), data: data.toString('base64') };
  });
  if (total > LIMITS.bytes) throw new Error(`앱이 너무 커요(${(total / 1024 / 1024).toFixed(1)}MB, 상한 ${LIMITS.bytes / 1024 / 1024}MB)`);
  const json: BundleJson = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, id: m.id, appVersion: m.version, files, sha256: treeHash(files) };
  return { bytes: gzipSync(JSON.stringify(json)), id: m.id, appVersion: m.version, fileName: `${m.id}-v${m.version}.${BUNDLE_EXT}` };
}

export interface Unpacked { id: string; appVersion: string; files: { path: string; mode: number; data: Buffer }[] }

/** 꾸러미 바이트 → 검증된 파일 목록. 틀린 곳이 있으면 throw(메시지는 사용자에게 보여도 되는 말) */
export function unpack(bytes: Buffer): Unpacked {
  let json: BundleJson;
  try {
    json = JSON.parse(gunzipSync(bytes, { maxOutputLength: LIMITS.jsonBytes }).toString('utf8')) as BundleJson;
  } catch (e) {
    const big = /exceed|larger|buffer/i.test((e as Error).message);
    throw new Error(big ? '파일이 비정상적으로 커요' : 'HackMac 앱 파일이 아니에요(읽을 수 없어요)');
  }
  if (json?.format !== BUNDLE_FORMAT) throw new Error('HackMac 앱 파일이 아니에요');
  if (json.version !== BUNDLE_VERSION) throw new Error(`이 HackMac이 모르는 파일 형식이에요(버전 ${String(json.version)}) — HackMac을 업데이트해 주세요`);
  if (!Array.isArray(json.files) || json.files.length === 0 || json.files.length > LIMITS.files) throw new Error('파일 목록이 올바르지 않아요');
  const seen = new Set<string>();
  let total = 0;
  const files = json.files.map((f) => {
    if (typeof f?.path !== 'string' || typeof f.data !== 'string' || typeof f.sha256 !== 'string') throw new Error('파일 항목이 올바르지 않아요');
    const parts = f.path.split('/');
    // 상대경로만, 빈 칸·점·.. 금지, 중복 금지(대소문자만 다른 것도 같은 파일로 본다 — macOS 기본 볼륨)
    if (!isPackagePath(f.path) || parts.some((p) => p === '' || p === '.' || p === '..') || f.path.includes('\0')) throw new Error(`안전하지 않은 경로: ${f.path.slice(0, 80)}`);
    const key = f.path.toLowerCase();
    if (seen.has(key)) throw new Error(`같은 경로가 두 번 들어 있어요: ${f.path}`);
    seen.add(key);
    const data = Buffer.from(f.data, 'base64');
    total += data.length;
    if (total > LIMITS.bytes) throw new Error('앱이 너무 커요');
    if (sha(data) !== f.sha256) throw new Error(`파일이 손상됐거나 바뀌었어요: ${f.path}`);
    return { path: f.path, mode: f.mode & 0o111 ? 0o755 : 0o644, data };
  });
  if (treeHash(json.files) !== json.sha256) throw new Error('파일 목록이 손상됐거나 바뀌었어요');
  if (typeof json.id !== 'string' || typeof json.appVersion !== 'string') throw new Error('앱 정보가 올바르지 않아요');
  return { id: json.id, appVersion: json.appVersion, files };
}

/** 검증된 파일을 빈 폴더에 쓴다 */
export function extract(u: Unpacked, destDir: string): void {
  for (const f of u.files) {
    const abs = join(destDir, f.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.data);
    chmodSync(abs, f.mode);
  }
}

export interface BundlePreview {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  appVersion: string;
  author: string;
  signed: boolean;
  /** 이미 설치된 같은 앱의 선언 버전. 없으면 null(새로 설치) */
  installedVersion: string | null;
  triggers: { hotkeys: number; resident: boolean; schedules: number; login: boolean };
  permissions: AppManifest['permissions'];
  secrets: string[];
  settings: string[];
  references: { repo: string; license: string; borrowed: string }[];
  /** 이 HackMac에 없는 능력. 비어 있지 않으면 설치할 수 없다 */
  missing: { name: string; need: string; have: number | null }[];
  files: number;
}

export type PreviewResult = { ok: true; preview: BundlePreview } | { ok: false; errors: string[] };

export interface PreviewContext {
  capabilities: Record<string, number>;
  installedVersion: (appId: string) => string | null;
  /** 시험용: 풀 임시 폴더 만들기 */
  tmpDir: () => { dir: string; cleanup: () => void };
}

/** 풀어서 선언만 읽는다. 스크립트·시험을 실행하지 않는다 */
export function preview(bytes: Buffer, ctx: PreviewContext): PreviewResult {
  let u: Unpacked;
  try {
    u = unpack(bytes);
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
  const tmp = ctx.tmpDir();
  try {
    extract(u, tmp.dir);
    const read = readPackage(tmp.dir);
    if (!read.ok) return { ok: false, errors: read.errors };
    const m = read.manifest;
    if (m.id !== u.id || m.version !== u.appVersion) return { ok: false, errors: ['꾸러미 겉 정보와 앱 선언이 달라요'] };
    const t = m.triggers;
    return {
      ok: true,
      preview: {
        id: m.id,
        name: m.name,
        icon: m.icon,
        tagline: m.tagline,
        appVersion: m.version,
        author: m.author.name,
        signed: m.author.signature !== null,
        installedVersion: ctx.installedVersion(m.id),
        triggers: { hotkeys: t.filter((x) => x.kind === 'hotkey').length, resident: t.some((x) => x.kind === 'resident'), schedules: t.filter((x) => x.kind === 'schedule').length, login: t.some((x) => x.kind === 'login') },
        permissions: m.permissions,
        secrets: m.secrets.map((s) => s.label),
        settings: m.settings.map((s) => s.label),
        references: m.references.map((r) => ({ repo: r.repo, license: r.license, borrowed: r.borrowed })),
        missing: missingCapabilities(m, ctx.capabilities),
        files: u.files.length,
      },
    };
  } finally {
    tmp.cleanup();
  }
}
