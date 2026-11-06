/**
 * 보관소: 설치된 앱의 버전 폴더와 "현재 버전"을 관리한다. Node 기본 모듈만 쓴다(Electron 없이 시험 가능).
 *
 *   <root>/<app-id>/
 *     current        현재 버전 번호 한 줄(원자적으로 바꿔 끼움)
 *     v<N>/          패키지(manifest.json + scripts/ ...). 설치 뒤 손대지 않는다
 *     data/          앱의 런타임 데이터($HACKMAC_DATA_DIR). 버전이 바뀌어도 남는다
 *
 * 설치는 "검증 → 다음 버전 폴더로 복사 → current 바꿔 끼우기" 순서라 중간에 꺼져도 옛 current가 남는다.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPackagePath, missingCapabilities, parseManifest, type AppManifest } from '../../shared/manifest.ts';

export interface InstalledApp {
  id: string;
  /** 현재 버전 번호. 설치됐지만 current가 없거나 깨졌으면 null */
  current: number | null;
  /** 있는 버전 번호들(오름차순) */
  versions: number[];
  dir: string;
}

export type InstallResult =
  | { ok: true; id: string; version: number; dir: string }
  | { ok: false; errors: string[] };

const VERSION_DIR_RE = /^v([1-9][0-9]*)$/;

const versionsIn = (appDir: string): number[] =>
  readdirSync(appDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => VERSION_DIR_RE.exec(d.name)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number)
    .sort((a, b) => a - b);

const readCurrent = (appDir: string, versions: number[]): number | null => {
  try {
    const n = Number(readFileSync(join(appDir, 'current'), 'utf8').trim());
    return versions.includes(n) ? n : null;
  } catch {
    return null;
  }
};

/** 임시 파일에 쓴 뒤 rename: 쓰다 끊겨도 반쪽 파일이 남지 않는다 */
const writeCurrent = (appDir: string, version: number): void => {
  const tmp = join(appDir, `current.${process.pid}.tmp`);
  writeFileSync(tmp, `${version}\n`);
  renameSync(tmp, join(appDir, 'current'));
};

/** 패키지 폴더의 manifest를 읽어 구조 검증 + 스크립트 존재 확인(문서 4절의 3) */
export const readPackage = (pkgDir: string): { ok: true; manifest: AppManifest } | { ok: false; errors: string[] } => {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(pkgDir, 'manifest.json'), 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`manifest.json을 읽을 수 없음: ${(e as Error).message}`] };
  }
  const parsed = parseManifest(raw);
  if (!parsed.ok) return parsed;
  const errors: string[] = [];
  parsed.manifest.triggers.forEach((t, i) => {
    if (isPackagePath(t.script) && !existsSync(join(pkgDir, t.script))) errors.push(`triggers[${i}].script: '${t.script}' 파일이 패키지에 없음`);
  });
  for (const banned of ['node_modules']) if (existsSync(join(pkgDir, banned))) errors.push(`${banned}/: 패키지에 둘 수 없음(앱은 의존을 동봉하지 않는다)`);
  return errors.length ? { ok: false, errors } : parsed;
};

export class Store {
  constructor(
    private readonly root: string,
    /** 이 HackMac이 가진 능력(이름 → 버전) */
    private readonly capabilities: Record<string, number>,
  ) {
    mkdirSync(root, { recursive: true });
  }

  list(): InstalledApp[] {
    return readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => this.get(d.name))
      .filter((a): a is InstalledApp => a !== null);
  }

  get(id: string): InstalledApp | null {
    const dir = join(this.root, id);
    if (!existsSync(dir)) return null;
    const versions = versionsIn(dir);
    return { id, current: readCurrent(dir, versions), versions, dir };
  }

  /** 현재 버전의 패키지 폴더 */
  currentDir(id: string): string | null {
    const app = this.get(id);
    return app?.current ? join(app.dir, `v${app.current}`) : null;
  }

  dataDir(id: string): string {
    const d = join(this.root, id, 'data');
    mkdirSync(d, { recursive: true });
    return d;
  }

  /**
   * 패키지 폴더를 검증해 설치한다. 같은 id가 있으면 다음 버전으로 들어가고 current가 옮겨 간다(업그레이드, data/ 유지).
   * manifest.version은 작성자의 번호이고, 여기의 버전 폴더 번호는 이 맥에 들어온 순서다 — 둘은 다르다.
   */
  install(pkgDir: string): InstallResult {
    const read = readPackage(pkgDir);
    if (!read.ok) return read;
    const m = read.manifest;
    const missing = missingCapabilities(m, this.capabilities);
    if (missing.length) {
      return { ok: false, errors: missing.map((x) => `능력 '${x.name}' ${x.need} 필요 (${x.have === null ? '없음' : `가진 것 ${x.have}`}) — HackMac 업데이트 필요`) };
    }
    const appDir = join(this.root, m.id);
    mkdirSync(appDir, { recursive: true });
    const version = (versionsIn(appDir).at(-1) ?? 0) + 1;
    const dest = join(appDir, `v${version}`);
    const staging = `${dest}.installing`;
    rmSync(staging, { recursive: true, force: true });
    cpSync(pkgDir, staging, { recursive: true, dereference: false });
    renameSync(staging, dest);
    writeCurrent(appDir, version);
    return { ok: true, id: m.id, version, dir: dest };
  }

  /** 있는 버전으로 current를 옮긴다("이전 버전으로"). 없는 버전이면 false */
  switchTo(id: string, version: number): boolean {
    const app = this.get(id);
    if (!app || !app.versions.includes(version)) return false;
    writeCurrent(app.dir, version);
    return true;
  }

  /** 앱을 지운다. data/까지 지우는 건 호출자가 명시해야 한다 */
  remove(id: string, { keepData }: { keepData: boolean }): void {
    const app = this.get(id);
    if (!app) return;
    if (keepData) {
      for (const v of app.versions) rmSync(join(app.dir, `v${v}`), { recursive: true, force: true });
      rmSync(join(app.dir, 'current'), { force: true });
    } else {
      rmSync(app.dir, { recursive: true, force: true });
    }
  }
}
