/**
 * 계정 목록: 같은 회사 계정을 최대 3개까지 두고, 회사마다 "지금 쓰는 계정"을 하나 정한다(수동 전환).
 *   - 기본 계정(`<vendor>-default`)은 사용자가 이미 로그인해 둔 그 CLI 설정(~/.claude, ~/.codex)이다. 파일에 저장하지 않고 늘 있다. 지울 수 없다.
 *   - 추가한 계정은 계정마다 설정 폴더를 따로 쓴다(Claude: CLAUDE_CONFIG_DIR, Codex: CODEX_HOME — 폴더가 미리 있어야 한다).
 *     로그인은 공식 CLI가 그 폴더 안에서 한다. HackMac은 토큰을 읽지도 저장하지도 않는다.
 *   - 자동 전환은 하지 않는다(사용자가 고른다). 스튜디오의 사용률 기반 자동 전환은 넣지 않기로 했다.
 * 파일 하나(<file>), 쓰기는 임시 파일 → rename. 못 읽으면 기본 계정만 있는 것으로 시작한다.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { accountEnv, VENDORS, type Vendor } from './cli.ts';

export const MAX_PER_VENDOR = 3;

export interface Account {
  id: string;
  vendor: Vendor;
  label: string;
  /** null이면 그 CLI의 기본 설정 폴더(사용자가 이미 로그인한 것) */
  configDir: string | null;
}

interface Stored { schema: 1; accounts: { id: string; vendor: Vendor; label: string }[]; active: Partial<Record<Vendor, string>> }

export const defaultId = (v: Vendor): string => `${v}-default`;
const DEFAULT_LABEL: Record<Vendor, string> = { claude: '기본 계정', codex: '기본 계정' };
const ID_RE = /^(claude|codex)-[1-9][0-9]*$/;

export class AccountStore {
  private data: Stored = { schema: 1, accounts: [], active: {} };

  /** root: 추가한 계정의 설정 폴더를 두는 곳(<root>/<id>/) */
  constructor(private readonly file: string, private readonly root: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored>;
      const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter((a) => ID_RE.test(a?.id) && VENDORS.includes(a.vendor) && a.id.startsWith(`${a.vendor}-`) && typeof a.label === 'string');
      const active: Stored['active'] = {};
      for (const v of VENDORS) {
        const a = raw.active?.[v];
        if (typeof a === 'string' && (a === defaultId(v) || accounts.some((x) => x.id === a))) active[v] = a;
      }
      this.data = { schema: 1, accounts, active };
    } catch {
      // 처음이거나 깨졌다: 기본 계정만으로 시작한다(추가한 계정의 폴더는 남아 있어도 목록에서만 빠진다)
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  private dirOf(id: string): string {
    return join(this.root, id);
  }

  list(vendor?: Vendor): Account[] {
    const make = (v: Vendor): Account[] => [
      { id: defaultId(v), vendor: v, label: DEFAULT_LABEL[v], configDir: null },
      ...this.data.accounts.filter((a) => a.vendor === v).map((a) => ({ ...a, configDir: this.dirOf(a.id) })),
    ];
    return (vendor ? [vendor] : [...VENDORS]).flatMap(make);
  }

  get(id: string): Account | null {
    return this.list().find((a) => a.id === id) ?? null;
  }

  activeId(vendor: Vendor): string {
    return this.data.active[vendor] ?? defaultId(vendor);
  }

  active(vendor: Vendor): Account {
    return this.get(this.activeId(vendor)) ?? this.list(vendor)[0];
  }

  /** 새 계정 칸을 만든다(폴더도). 로그인은 따로. 회사당 최대 3개 */
  add(vendor: Vendor, label?: string): { ok: true; account: Account } | { ok: false; error: string } {
    const mine = this.list(vendor);
    if (mine.length >= MAX_PER_VENDOR) return { ok: false, error: `계정은 한 회사에 최대 ${MAX_PER_VENDOR}개까지예요` };
    const used = new Set(this.data.accounts.map((a) => a.id));
    let n = 2;
    while (used.has(`${vendor}-${n}`)) n++;
    const id = `${vendor}-${n}`;
    const clean = (label ?? '').trim().slice(0, 30) || `계정 ${mine.length + 1}`;
    mkdirSync(this.dirOf(id), { recursive: true, mode: 0o700 });
    this.data.accounts.push({ id, vendor, label: clean });
    this.save();
    return { ok: true, account: this.get(id)! };
  }

  rename(id: string, label: string): boolean {
    const a = this.data.accounts.find((x) => x.id === id);
    const clean = label.trim().slice(0, 30);
    if (!a || !clean) return false;
    a.label = clean;
    this.save();
    return true;
  }

  /** 추가한 계정을 지운다(그 설정 폴더 — 로그인 정보 포함 — 도 지운다). 기본 계정은 못 지운다 */
  remove(id: string): boolean {
    const a = this.data.accounts.find((x) => x.id === id);
    if (!a) return false;
    this.data.accounts = this.data.accounts.filter((x) => x.id !== id);
    if (this.data.active[a.vendor] === id) delete this.data.active[a.vendor];
    this.save();
    rmSync(this.dirOf(id), { recursive: true, force: true });
    return true;
  }

  setActive(id: string): boolean {
    const a = this.get(id);
    if (!a) return false;
    this.data.active[a.vendor] = id;
    this.save();
    return true;
  }

  /** 그 계정으로 CLI를 부를 때 주는 환경변수(기본 계정이면 비어 있다) */
  env(id: string): Record<string, string> {
    const a = this.get(id);
    return a ? accountEnv(a.vendor, a.configDir) : {};
  }
}

/** 그 계정의 실제 설정 폴더(기본 계정은 CLI의 기본 위치) */
export const configDirOf = (a: Account, home = homedir(), env: NodeJS.ProcessEnv = process.env): string =>
  a.configDir ?? (a.vendor === 'claude' ? env.CLAUDE_CONFIG_DIR || join(home, '.claude') : env.CODEX_HOME || join(home, '.codex'));
