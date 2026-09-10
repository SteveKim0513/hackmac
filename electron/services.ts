import fs from 'node:fs';
import path from 'node:path';
import { parseServiceScript } from './parser';
import { runScript } from './runner';
import { notifyRunResult } from './notify';
import { hotkeyRegistrar } from './hotkeys';
import { servicesDir } from './paths';
import { loadSettings, saveSettings } from './settings';
import type { ActivateResult, ServiceManifest, ServiceMeta } from '../shared/types';

interface LoadedService {
  manifest: ServiceManifest;
  scriptsDir: string;
}

// Bundled services never change while the app is running (they're read-only
// resources, not a user-editable folder), so a one-time scan at startup is
// enough — no folder watcher needed, unlike mac-shortcut-manager's registry.
class ServiceCatalog {
  private services = new Map<string, LoadedService>();
  private active = new Set<string>();

  init(): void {
    const dir = servicesDir();
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      console.error('[services] failed to read services dir', dir, err);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const serviceDir = path.join(dir, entry.name);
      const manifestPath = path.join(serviceDir, 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ServiceManifest;
        this.services.set(manifest.id, { manifest, scriptsDir: path.join(serviceDir, 'scripts') });
      } catch (err) {
        console.error('[services] failed to load manifest', manifestPath, err);
      }
    }

    const settings = loadSettings();
    for (const id of settings.activeServiceIds) {
      if (this.services.has(id)) this.activate(id);
    }
  }

  list(): ServiceMeta[] {
    return [...this.services.values()]
      .map((s) => this.toMeta(s))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  private toMeta(loaded: LoadedService): ServiceMeta {
    const shortcuts = this.listShortcuts(loaded);
    return { ...loaded.manifest, shortcuts, isActive: this.active.has(loaded.manifest.id) };
  }

  private listShortcuts(loaded: LoadedService) {
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(loaded.scriptsDir)
        .filter((f) => f.endsWith('.sh'))
        .sort();
    } catch {
      return [];
    }
    return files.map((f) => parseServiceScript(path.join(loaded.scriptsDir, f)));
  }

  activate(id: string): ActivateResult {
    const loaded = this.services.get(id);
    if (!loaded) return { ok: false, errors: [{ shortcutId: id, name: id, message: '서비스를 찾을 수 없어요' }] };

    const shortcuts = this.listShortcuts(loaded);
    const errors: ActivateResult['errors'] = [];
    for (const shortcut of shortcuts) {
      if (!shortcut.hotkey) continue;
      const ownerId = `${id}:${shortcut.id}`;
      const result = hotkeyRegistrar.claim(shortcut.hotkey, ownerId, `${loaded.manifest.name} · ${shortcut.name}`, () => {
        void runScript(shortcut.scriptPath).then((r) => notifyRunResult(shortcut, r));
      });
      if (!result.ok) {
        const message = result.conflictLabel
          ? `이미 "${result.conflictLabel}"에서 쓰고 있는 단축키예요`
          : '이 단축키는 이미 다른 앱이 쓰고 있는 것 같아요';
        errors.push({ shortcutId: shortcut.id, name: shortcut.name, message });
      }
    }

    this.active.add(id);
    this.persist();
    return { ok: errors.length === 0, errors };
  }

  deactivate(id: string): void {
    const loaded = this.services.get(id);
    if (!loaded) return;
    for (const shortcut of this.listShortcuts(loaded)) {
      hotkeyRegistrar.release(`${id}:${shortcut.id}`);
    }
    this.active.delete(id);
    this.persist();
  }

  private persist(): void {
    saveSettings({ activeServiceIds: [...this.active] });
  }

  dispose(): void {
    hotkeyRegistrar.releaseAll();
  }
}

export const serviceCatalog = new ServiceCatalog();
