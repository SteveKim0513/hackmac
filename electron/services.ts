import fs from 'node:fs';
import path from 'node:path';
import { parseServiceScript } from './parser';
import { runScript } from './runner';
import { notifyRunResult } from './notify';
import { hotkeyRegistrar } from './hotkeys';
import { hideRunningStatus, showRunningStatus } from './popupWindow';
import { servicesDir } from './paths';
import { loadSettings, saveSettings } from './settings';
import { appLog, describeError, serviceTag } from './log';
import type { ActivateResult, ServiceManifest, ServiceMeta } from '../shared/types';

interface LoadedService {
  manifest: ServiceManifest;
  scriptsDir: string;
}

// 짧은 간격으로 같은 단축키를 여러 번 누르면(사람이 "안 눌렸나" 하고 다시
// 누르는 경우가 실제 사용 로그에서 확인됨) 각 keypress가 독립된 스크립트
// 프로세스를 그대로 spawn했다 — 같은 Reminders 리스트를 두세 개 프로세스가
// 동시에 건드리는 위험한 상황으로 이어질 수 있다. ownerId(`${serviceId}:
// ${shortcutId}`)별로 실행 중 여부를 추적해, 이전 실행이 끝나기 전 같은
// 단축키가 다시 눌리면 조용히 무시한다.
const runningOwners = new Set<string>();

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
      appLog.error('services', `서비스 폴더를 읽을 수 없음: ${dir} — ${describeError(err)}`);
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const serviceDir = path.join(dir, entry.name);
      const manifestPath = path.join(serviceDir, 'manifest.json');
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ServiceManifest;
        this.services.set(manifest.id, { manifest, scriptsDir: path.join(serviceDir, 'scripts') });
        appLog.info('services', `${serviceTag(manifest.id)} 매니페스트 로드됨: ${manifestPath}`);
      } catch (err) {
        appLog.error('services', `매니페스트 로드 실패: ${manifestPath} — ${describeError(err)}`);
      }
    }
    appLog.info('services', `카탈로그 스캔 완료: ${dir} — ${this.services.size}개 서비스 로드됨`);

    const settings = loadSettings();
    for (const id of settings.activeServiceIds) {
      if (this.services.has(id)) {
        this.activate(id);
      } else {
        appLog.warn('services', `${serviceTag(id)} 설정에 있지만 카탈로그에 없어 건너뜀`);
      }
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
    } catch (err) {
      appLog.warn('services', `${serviceTag(loaded.manifest.id)} 스크립트 폴더를 읽을 수 없음: ${loaded.scriptsDir} — ${describeError(err)}`);
      return [];
    }
    return files.map((f) => parseServiceScript(path.join(loaded.scriptsDir, f)));
  }

  activate(id: string): ActivateResult {
    const loaded = this.services.get(id);
    if (!loaded) {
      appLog.error('services', `activate: 알 수 없는 서비스 id: ${id}`);
      return { ok: false, errors: [{ shortcutId: id, name: id, message: '서비스를 찾을 수 없어요' }] };
    }

    const shortcuts = this.listShortcuts(loaded);
    const errors: ActivateResult['errors'] = [];
    for (const shortcut of shortcuts) {
      if (!shortcut.hotkey) continue;
      const ownerId = `${id}:${shortcut.id}`;
      const result = hotkeyRegistrar.claim(shortcut.hotkey, ownerId, `${loaded.manifest.name} · ${shortcut.name}`, () => {
        if (runningOwners.has(ownerId)) {
          appLog.warn('services', `${serviceTag(id)} 단축키 무시: ${shortcut.name} (${shortcut.hotkey}) — 이전 실행이 아직 진행 중`);
          return;
        }
        runningOwners.add(ownerId);
        appLog.info('services', `${serviceTag(id)} 단축키 실행: ${shortcut.name} (${shortcut.hotkey})`);
        // 스크립트가 첫 팝업을 띄우기까지(Reminders 조회 등으로) 몇 초씩
        // 걸릴 수 있는데, 그동안 화면에 아무 피드백이 없으면 "안 눌렸나" 하고
        // 다시 누르게 된다 — 그 공백을 메우는 표시. 스크립트가 실제 팝업을
        // 요청하는 순간(popupWindow.ts의 showPopup) 자동으로 밀려나고, 팝업을
        // 한 번도 안 띄우는 스크립트라면 아래 완료 시점에 닫힌다.
        showRunningStatus(`${shortcut.name} 실행 중…`);
        void runScript(shortcut.scriptPath, id).then((r) => {
          runningOwners.delete(ownerId);
          hideRunningStatus();
          // 이 한 줄이 app.log에서 실행 로그 파일로 가는 유일한 다리다 —
          // 성공/실패 여부와 실행 로그 경로를 한 번에 남겨서, "이 실행 무슨
          // 일이 있었지"를 앱 로그만 보고도 바로 어느 파일을 열어야 할지
          // 알 수 있게 한다.
          appLog.info(
            'services',
            `${serviceTag(id)} 단축키 실행 완료: ${shortcut.name} — 성공=${r.success} 코드=${r.code ?? '없음'} 로그=${r.logPath}`,
          );
          notifyRunResult(shortcut, r);
        });
      });
      if (!result.ok) {
        const message = result.conflictLabel
          ? `이미 "${result.conflictLabel}"에서 쓰고 있는 단축키예요`
          : '이 단축키는 이미 다른 앱이 쓰고 있는 것 같아요';
        appLog.warn('services', `${serviceTag(id)} 단축키 등록 실패: ${shortcut.name} (${shortcut.hotkey}) — ${message}`);
        errors.push({ shortcutId: shortcut.id, name: shortcut.name, message });
      }
    }

    this.active.add(id);
    this.persist();
    appLog.info('services', `${serviceTag(id)} 활성화 (오류 ${errors.length}건)`);
    return { ok: errors.length === 0, errors };
  }

  deactivate(id: string): void {
    const loaded = this.services.get(id);
    if (!loaded) {
      appLog.warn('services', `deactivate: 알 수 없는 서비스 id: ${id}`);
      return;
    }
    for (const shortcut of this.listShortcuts(loaded)) {
      hotkeyRegistrar.release(`${id}:${shortcut.id}`);
    }
    this.active.delete(id);
    this.persist();
    appLog.info('services', `${serviceTag(id)} 비활성화`);
  }

  private persist(): void {
    saveSettings({ activeServiceIds: [...this.active] });
  }

  dispose(): void {
    hotkeyRegistrar.releaseAll();
  }
}

export const serviceCatalog = new ServiceCatalog();
