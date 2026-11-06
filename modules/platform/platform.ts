/**
 * 플랫폼: 보관소·설정·단축키 자리·실행기·원장을 잇는다. Electron이 하는 일(전역 단축키 등록, 팝업 소켓 env)은 주입받아
 * Electron 없이 시험한다. 실행 서버 진입점(electron/)은 이 클래스를 만들고 붙이기만 한다.
 *
 * 켜기: manifest 읽기 → 자리 배정 → 단축키 등록 → 상주 시작 → 스케줄 등록 → enabled 저장.
 * 끄기: 그 반대. 자리는 돌려주되 hotkeysPrevious에 남겨 다시 켜면 같은 자리를 받게 한다.
 * 복원: 실행 서버가 다시 뜨면 settings.enabled 순서대로 켠다. 하나가 실패해도 나머지는 켠다.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppManifest, Trigger } from '../../shared/manifest.ts';
import { assign, fillHotkeys, release, slotId, type Assignments } from '../hotkey/slots.ts';
import { extract, pack, preview, unpack, type BundlePreview } from '../bundle/bundle.ts';
import { Ledger } from '../ledger/ledger.ts';
import { cronMatches, parseCron, type Cron } from '../runner/cron.ts';
import { Runner, type RunContext, type RunnerEvent, type RunResult } from '../runner/runner.ts';
import { Settings } from '../settings/settings.ts';
import { writeV2Package } from '../store/fromV1.ts';
import { readPackage, Store, type InstalledApp } from '../store/store.ts';

export interface HotkeyPort {
  /** 등록. 다른 프로그램이 쥐고 있어 실패하면 false */
  register(accelerator: string, cb: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface PlatformOptions {
  paths: { apps: string; logs: string; ledger: string; settings: string };
  /** 이 HackMac이 가진 능력(이름 → 버전) */
  capabilities: Record<string, number>;
  /** 능력이 스크립트에 주는 env(HACKMAC_POPUP 등). 켤 때마다 다시 묻는다 */
  capabilityEnv: () => Record<string, string>;
  hotkeys: HotkeyPort;
  hackmacVersion: string;
  /** 단축키 실행의 앞뒤(실행 중 표시, 실패 알림). 호출자가 화면을 그린다 */
  hooks?: {
    onHotkeyRunStart?: (appId: string, trigger: Extract<Trigger, { kind: 'hotkey' }>) => void;
    onHotkeyRunEnd?: (appId: string, trigger: Extract<Trigger, { kind: 'hotkey' }>, result: RunResult) => void;
  };
  now?: () => Date;
  /** 시험용 실행기 옵션 */
  runner?: Partial<ConstructorParameters<typeof Runner>[0]>;
}

export interface AppView {
  id: string;
  version: number | null;
  versions: number[];
  enabled: boolean;
  /** 켜져 있는데 일부 트리거가 못 붙었을 때 */
  problems: string[];
  /** 카피의 {hotkey:<key>}를 배정된 자리로 채운 선언. 켜져 있지 않으면 '단축키' */
  manifest: AppManifest | null;
  hotkeys: { key: string; name: string; slot: string | null }[];
}

export type EnableResult = { ok: true; problems: string[] } | { ok: false; reason: string };

interface Live { manifest: AppManifest; accelerators: string[]; schedules: { cron: Cron | null; everySec: number | null; trigger: Trigger; lastRun: number }[] }

export class Platform {
  readonly store: Store;
  readonly settings: Settings;
  readonly ledger: Ledger;
  readonly runner: Runner;
  private readonly live = new Map<string, Live>();
  private readonly listeners = new Set<(e: RunnerEvent) => void>();
  private readonly now: () => Date;
  private ticker: NodeJS.Timeout | null = null;

  constructor(private readonly o: PlatformOptions) {
    this.now = o.now ?? (() => new Date());
    this.store = new Store(o.paths.apps, o.capabilities);
    this.settings = new Settings(o.paths.settings);
    this.ledger = new Ledger(o.paths.ledger, this.now);
    this.runner = new Runner({
      logsRoot: o.paths.logs,
      onEvent: (e) => {
        this.ledger.append(e);
        for (const l of this.listeners) {
          try { l(e); } catch { /* 듣는 쪽 오류가 실행기를 멈추지 않는다 */ }
        }
      },
      ...o.runner,
    });
  }

  /** 실행기 사건을 듣는다(감시자). 돌려받은 함수로 끊는다 */
  subscribe(cb: (e: RunnerEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isEnabled(appId: string): boolean {
    return this.live.has(appId);
  }

  /**
   * 고친 패키지를 새 버전으로 설치하고, 켜져 있던 앱이면 다시 켜서 새 버전으로 돌게 한다. 단축키 자리는 그대로(hotkeysPrevious).
   * 새 버전을 켜지 못하면(선언이 맞지 않는 등) 옛 버전으로 되돌려 다시 켠다 — 고친다고 멀쩡히 돌던 앱이 멈추면 안 된다.
   */
  async applyFix(pkgDir: string, appId: string): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
    const wasEnabled = this.live.has(appId);
    const before = this.store.get(appId)?.current ?? null;
    const r = this.install(pkgDir);
    if (!r.ok) return { ok: false, error: r.errors.join('; ') };
    if (r.id !== appId) {
      if (before !== null) this.store.switchTo(appId, before);
      return { ok: false, error: `수정본의 id(${r.id})가 앱 id(${appId})와 달라요` };
    }
    if (!wasEnabled) return { ok: true, version: r.version };
    await this.disable(appId);
    const e = this.enable(appId);
    if (e.ok) return { ok: true, version: r.version };
    if (before !== null) this.store.switchTo(appId, before);
    this.enable(appId);
    this.ledger.append({ kind: 'app.fix.rolledback', appId, version: r.version, reason: e.reason });
    return { ok: false, error: `새 버전을 켜지 못해 되돌렸어요: ${e.reason}` };
  }

  /** 번들된 v1 서비스를 보관소에 기본 앱으로 넣는다(이미 있으면 건너뜀). 실패해도 다른 서비스는 계속 */
  installBundledV1(servicesDir: string): { installed: string[]; errors: string[] } {
    const installed: string[] = [];
    const errors: string[] = [];
    if (!existsSync(servicesDir)) return { installed, errors };
    for (const name of readdirSync(servicesDir)) {
      const dir = join(servicesDir, name);
      if (!existsSync(join(dir, 'manifest.json'))) continue;
      const id = `hackmac.${name}`;
      if (this.store.get(id)?.current) continue;
      const tmp = mkdtempSync(join(tmpdir(), 'hackmac-v1-'));
      try {
        writeV2Package(dir, tmp, this.o.hackmacVersion);
        const r = this.store.install(tmp);
        if (r.ok) installed.push(r.id);
        else errors.push(`${name}: ${r.errors.join('; ')}`);
      } catch (e) {
        errors.push(`${name}: ${(e as Error).message}`);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    if (errors.length) this.ledger.append({ kind: 'bundled.install.error', errors });
    return { installed, errors };
  }

  /** 패키지 폴더를 설치한다(사용자가 파일을 올렸을 때·제작이 끝났을 때). 켜는 건 따로 */
  install(pkgDir: string) {
    const r = this.store.install(pkgDir);
    this.ledger.append(r.ok ? { kind: 'app.installed', appId: r.id, version: r.version } : { kind: 'app.install.rejected', errors: r.errors });
    return r;
  }

  private tmpDir() {
    const dir = mkdtempSync(join(tmpdir(), 'hackmac-bundle-'));
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  }

  /** 설치된 앱의 현재 버전을 파일 하나(.hackapp)로 내보낸다. 설정값·비밀값·데이터는 들어가지 않는다 */
  exportApp(appId: string, destFile: string): { ok: true; file: string; fileName: string } | { ok: false; error: string } {
    const dir = this.store.currentDir(appId);
    if (!dir) return { ok: false, error: '설치돼 있지 않거나 현재 버전이 없어요' };
    try {
      const p = pack(dir);
      writeFileSync(destFile, p.bytes);
      this.ledger.append({ kind: 'app.exported', appId, version: p.appVersion, bytes: p.bytes.length });
      return { ok: true, file: destFile, fileName: p.fileName };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** 받은 파일을 풀어 선언만 읽는다(아무것도 실행하지 않는다). 사용자가 이걸 보고 설치를 정한다 */
  previewBundle(file: string): { ok: true; preview: BundlePreview } | { ok: false; errors: string[] } {
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch (e) {
      return { ok: false, errors: [`파일을 읽을 수 없어요: ${(e as Error).message}`] };
    }
    return preview(bytes, {
      capabilities: this.o.capabilities,
      installedVersion: (id) => {
        const dir = this.store.currentDir(id);
        const r = dir ? readPackage(dir) : null;
        return r?.ok ? r.manifest.version : null;
      },
      tmpDir: () => this.tmpDir(),
    });
  }

  /** 미리 보기를 통과한 꾸러미를 설치한다. 켜는 건 따로(사용자가) 한다 */
  installBundle(file: string): ReturnType<Store['install']> {
    const pv = this.previewBundle(file);
    if (!pv.ok) return { ok: false, errors: pv.errors };
    if (pv.preview.missing.length) {
      return { ok: false, errors: pv.preview.missing.map((x) => `능력 '${x.name}' ${x.need} 필요 — HackMac 업데이트가 필요해요`) };
    }
    const tmp = this.tmpDir();
    try {
      extract(unpack(readFileSync(file)), tmp.dir);
      const r = this.install(tmp.dir);
      if (r.ok) this.ledger.append({ kind: 'app.imported', appId: r.id, version: r.version, from: 'file' });
      return r;
    } catch (e) {
      return { ok: false, errors: [(e as Error).message] };
    } finally {
      tmp.cleanup();
    }
  }

  list(): AppView[] {
    return this.store.list().map((a) => this.view(a));
  }

  view(a: InstalledApp): AppView {
    const dir = a.current ? join(a.dir, `v${a.current}`) : null;
    const read = dir ? readPackage(dir) : null;
    const manifest = read?.ok ? read.manifest : null;
    const s = this.settings.get();
    const enabled = this.live.has(a.id);
    const hotkeys = manifest ? manifest.triggers.filter((t): t is Extract<Trigger, { kind: 'hotkey' }> => t.kind === 'hotkey').map((t) => ({ key: t.key, name: t.name, slot: s.hotkeys[slotId(a.id, t.key)] ?? null })) : [];
    const filled = manifest ? this.fillCopy(manifest, a.id, s.hotkeys) : null;
    const problems = read && !read.ok ? read.errors : this.problems.get(a.id) ?? [];
    return { id: a.id, version: a.current, versions: a.versions, enabled, problems, manifest: filled, hotkeys };
  }

  private readonly problems = new Map<string, string[]>();
  /** 지금 돌고 있는 단축키 트리거(appId/key) */
  private readonly busy = new Set<string>();

  private fillCopy(m: AppManifest, appId: string, a: Assignments): AppManifest {
    const f = (s: string) => fillHotkeys(s, a, appId);
    const fa = (xs?: string[]) => xs?.map(f);
    return { ...m, tagline: f(m.tagline), usage: m.usage.map(f), whatItIs: fa(m.whatItIs), differentiators: fa(m.differentiators), strengths: fa(m.strengths) };
  }

  private context(appId: string, manifest: AppManifest): RunContext {
    const s = this.settings.get();
    const values = s.appSettings[appId] ?? {};
    const settings: Record<string, string> = {};
    for (const d of manifest.settings) {
      const v = values[d.key] ?? (d.default !== undefined ? (typeof d.default === 'string' ? d.default : JSON.stringify(d.default)) : undefined);
      if (v !== undefined) settings[d.key] = v;
    }
    return { appId, appDir: this.store.currentDir(appId)!, dataDir: this.store.dataDir(appId), settings, secrets: {}, env: this.o.capabilityEnv() };
  }

  async runTrigger(appId: string, trigger: Trigger): Promise<RunResult | null> {
    const l = this.live.get(appId);
    if (!l) return null;
    return this.runner.runOnce(this.context(appId, l.manifest), trigger);
  }

  enable(appId: string): EnableResult {
    if (this.live.has(appId)) return { ok: true, problems: this.problems.get(appId) ?? [] };
    const dir = this.store.currentDir(appId);
    if (!dir) return { ok: false, reason: '설치돼 있지 않거나 현재 버전이 없음' };
    const read = readPackage(dir);
    if (!read.ok) return { ok: false, reason: read.errors.join('; ') };
    const m = read.manifest;
    const s = this.settings.get();
    const required = m.settings.filter((d) => d.required && d.default === undefined && !(s.appSettings[appId]?.[d.key]));
    if (required.length) return { ok: false, reason: `설정 필요: ${required.map((d) => d.label).join(', ')}` };

    const hotkeyTriggers = m.triggers.filter((t): t is Extract<Trigger, { kind: 'hotkey' }> => t.kind === 'hotkey');
    const assigned = assign(s.hotkeys, appId, hotkeyTriggers.map((t) => t.key), s.hotkeysPrevious);
    if (!assigned) return { ok: false, reason: '단축키 자리가 없음' };

    const problems: string[] = [];
    const accelerators: string[] = [];
    const ctx = () => this.context(appId, m);
    for (const t of hotkeyTriggers) {
      const accel = assigned[slotId(appId, t.key)];
      const owner = slotId(appId, t.key);
      const fire = () => {
        // 사람이 "안 눌렸나" 하고 같은 키를 다시 누르면 같은 스크립트가 겹쳐 돈다(v1 실사용 로그). 끝나기 전 재입력은 버린다
        if (this.busy.has(owner)) return;
        this.busy.add(owner);
        this.o.hooks?.onHotkeyRunStart?.(appId, t);
        void this.runner.runOnce(ctx(), t).then((r) => {
          this.busy.delete(owner);
          this.o.hooks?.onHotkeyRunEnd?.(appId, t, r);
        });
      };
      if (this.o.hotkeys.register(accel, fire)) accelerators.push(accel);
      else problems.push(`${t.name}: 단축키 ${accel}를 다른 프로그램이 쓰고 있음`);
    }
    const resident = m.triggers.find((t): t is Extract<Trigger, { kind: 'resident' }> => t.kind === 'resident');
    if (resident) this.runner.startResident(ctx(), resident);
    const schedules: Live['schedules'] = [];
    for (const t of m.triggers) {
      if (t.kind !== 'schedule') continue;
      const cron = t.cron ? parseCron(t.cron) : null;
      if (t.cron && !cron) { problems.push(`${t.name}: cron '${t.cron}'을 읽을 수 없음`); continue; }
      schedules.push({ cron, everySec: t.every ?? null, trigger: t, lastRun: 0 });
    }
    for (const t of m.triggers) if (t.kind === 'login') void this.runner.runOnce(ctx(), t);

    this.live.set(appId, { manifest: m, accelerators, schedules });
    this.problems.set(appId, problems);
    this.settings.update({ hotkeys: assigned, enabled: [...new Set([...s.enabled, appId])] });
    this.ledger.append({ kind: 'app.enabled', appId, problems });
    this.ensureTicker();
    return { ok: true, problems };
  }

  async disable(appId: string): Promise<void> {
    const l = this.live.get(appId);
    if (!l) return;
    this.live.delete(appId);
    this.problems.delete(appId);
    for (const a of l.accelerators) this.o.hotkeys.unregister(a);
    await this.runner.stopResident(appId);
    const s = this.settings.get();
    const prefix = `${appId}/`;
    const previous = { ...s.hotkeysPrevious, ...Object.fromEntries(Object.entries(s.hotkeys).filter(([id]) => id.startsWith(prefix))) };
    this.settings.update({ hotkeys: release(s.hotkeys, appId), hotkeysPrevious: previous, enabled: s.enabled.filter((x) => x !== appId) });
    this.ledger.append({ kind: 'app.disabled', appId });
    if (this.live.size === 0) this.stopTicker();
  }

  /** 실행 서버가 다시 떴을 때. 하나가 실패해도 나머지는 켠다 */
  restore(): { enabled: string[]; failed: { id: string; reason: string }[] } {
    const enabled: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const id of this.settings.get().enabled) {
      const r = this.enable(id);
      if (r.ok) enabled.push(id);
      else {
        failed.push({ id, reason: r.reason });
        this.ledger.append({ kind: 'app.restore.failed', appId: id, reason: r.reason });
      }
    }
    return { enabled, failed };
  }

  /** 스케줄 점검. 1분마다 부른다(시험은 직접 부른다) */
  tick(now: Date = this.now()): void {
    const minute = Math.floor(now.getTime() / 60_000);
    for (const [appId, l] of this.live) {
      for (const sch of l.schedules) {
        const due = sch.cron ? cronMatches(sch.cron, now) && sch.lastRun !== minute : sch.everySec !== null && now.getTime() - sch.lastRun * 60_000 >= sch.everySec * 1000;
        if (!due) continue;
        sch.lastRun = sch.cron ? minute : now.getTime() / 60_000;
        void this.runner.runOnce(this.context(appId, l.manifest), sch.trigger);
      }
    }
  }

  private ensureTicker(): void {
    if (this.ticker || this.o.now) return; // 시험(now 주입)에서는 타이머를 돌리지 않는다
    this.ticker = setInterval(() => this.tick(), 60_000);
    this.ticker.unref();
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  async shutdown(): Promise<void> {
    this.stopTicker();
    for (const [, l] of this.live) for (const a of l.accelerators) this.o.hotkeys.unregister(a);
    this.live.clear();
    await this.runner.stopAll();
  }
}

export const ensureDirs = (paths: PlatformOptions['paths']): void => {
  for (const p of [paths.apps, paths.logs, paths.ledger]) mkdirSync(p, { recursive: true });
};
