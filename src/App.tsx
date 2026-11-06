import { useEffect, useState } from 'react';
import type { ServiceMeta, ThemePreference } from '../shared/types';
import { VENDOR_LABEL, type AccountsView, type BundlePreview, type ThreadView } from '../shared/studio';
import { ServiceGrid } from './store/ServiceGrid';
import { ServiceDetail } from './detail/ServiceDetail';
import { ToastStack, useToasts } from './components/Toast';
import { ThemeSwitch } from './components/ThemeSwitch';
import { BundlePreviewDialog } from './studio/BundlePreviewDialog';
import { Onboarding } from './studio/Onboarding';
import { ThreadPage } from './studio/ThreadPage';
import './studio/studio.css';

type View = { name: 'store' } | { name: 'detail'; serviceId: string } | { name: 'thread'; threadId: string };

export default function App() {
  const [services, setServices] = useState<ServiceMeta[]>([]);
  const [view, setView] = useState<View>({ name: 'store' });
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [accounts, setAccounts] = useState<AccountsView | null>(null);
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [bundle, setBundle] = useState<{ file: string; preview: BundlePreview } | null>(null);
  const [installing, setInstalling] = useState(false);
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    void window.playbook.listServices().then(setServices);
    void window.playbook.getThemePreference().then(setThemePreferenceState);
    void window.studio.accounts(true).then(setAccounts);
    void window.studio.threads().then(setThreads);
    const offAccounts = window.studio.onAccountsChanged(setAccounts);
    // 제작이 앱을 보관소에 넣으면 "내 앱"을 다시 읽는다
    const offServices = window.studio.onServicesChanged(() => void window.playbook.listServices().then(setServices));
    // 스레드 제목·바쁨이 바뀌면 홈 목록도 다시 읽는다(목록은 작아서 매번 다 읽어도 된다)
    const offChat = window.studio.onChat((_id, e) => {
      if (e.kind === 'message' || e.kind === 'state') void window.studio.threads().then(setThreads);
    });
    return () => {
      offAccounts();
      offServices();
      offChat();
    };
  }, []);

  // 받은 앱 파일: 고르면 선언 요약만 보여 주고(아무것도 실행하지 않는다), 사용자가 확인하면 설치한다
  const handlePickBundle = async () => {
    const r = await window.playbook.pickBundle();
    if (!r.picked) return;
    if (!r.result.ok) return push(`이 파일은 설치할 수 없어요: ${r.result.errors.join(' / ')}`, 'error');
    setBundle({ file: r.file, preview: r.result.preview });
  };

  const handleInstallBundle = async () => {
    if (!bundle) return;
    setInstalling(true);
    const r = await window.playbook.installBundle(bundle.file);
    setInstalling(false);
    if (!r.ok) return push(`설치하지 못했어요: ${r.errors.join(' / ')}`, 'error');
    const name = bundle.preview.name;
    setBundle(null);
    setServices(await window.playbook.listServices());
    push(`${bundle.preview.icon} ${name}을(를) 내 앱에 넣었어요. 카드를 눌러 켜세요`);
  };

  const handleExport = async (service: ServiceMeta) => {
    const r = await window.playbook.exportApp(service.id);
    if (r.exported) push(`${service.name}을(를) 파일로 내보냈어요`);
    else if (r.error) push(`내보내지 못했어요: ${r.error}`, 'error');
  };

  const handleCreate = async () => {
    const meta = await window.studio.createThread('');
    void window.studio.threads().then(setThreads);
    setView({ name: 'thread', threadId: meta.id });
  };

  const handleThemeChange = (pref: ThemePreference) => {
    setThemePreferenceState(pref); // 낙관적 반영 — nativeTheme 갱신은 IPC 왕복 없이 즉시 눈에 보여야 자연스럽다.
    void window.playbook.setThemePreference(pref);
  };

  const handleActivate = async (service: ServiceMeta) => {
    const result = await window.playbook.activateService(service.id);
    const refreshed = await window.playbook.listServices();
    setServices(refreshed);
    if (result.ok) {
      push(`${service.icon} ${service.name}을(를) 켰어요`);
    } else {
      push(`${service.name} 일부 단축키를 켜지 못했어요: ${result.errors.map((e) => e.message).join(', ')}`, 'error');
    }
  };

  const handleToggle = async (service: ServiceMeta) => {
    if (service.isActive) {
      await window.playbook.deactivateService(service.id);
      push(`${service.icon} ${service.name}을(를) 껐어요`);
    } else {
      const result = await window.playbook.activateService(service.id);
      if (result.ok) push(`${service.icon} ${service.name}을(를) 켰어요`);
      else push(`${service.name} 일부 단축키를 켜지 못했어요: ${result.errors.map((e) => e.message).join(', ')}`, 'error');
    }
    const refreshed = await window.playbook.listServices();
    setServices(refreshed);
  };

  const handleCheckForUpdates = async () => {
    const result = await window.playbook.checkForUpdates();
    if (result.status === 'up-to-date') push('이미 최신 버전이에요');
    else if (result.status === 'downloading') push(`새 버전 v${result.version}을 받고 있어요 — 다 받으면 재시동을 물어볼게요`);
    else if (result.status === 'disabled') push('개발 모드에서는 업데이트를 확인하지 않아요');
    else push(`업데이트를 확인하지 못했어요: ${result.message}`, 'error');
  };

  const selected = view.name === 'detail' ? services.find((s) => s.id === view.serviceId) ?? null : null;

  // 엔진을 아직 확인하는 중(첫 1초 남짓)
  if (!accounts) {
    return <div className="app-shell app-loading">AI 계정을 확인하는 중…</div>;
  }
  // 로그인한 엔진이 없거나 둘 중 골라야 하면 첫 실행 화면이 먼저다(계획서 2절)
  if (!accounts.engine) {
    return (
      <div className="app-shell">
        <Onboarding accounts={accounts} onAccounts={setAccounts} />
      </div>
    );
  }

  if (view.name === 'thread') {
    return (
      <div className="app-shell is-thread">
        <ToastStack toasts={toasts} onDismiss={dismiss} />
        <ThreadPage
          threadId={view.threadId}
          onBack={() => {
            void window.studio.threads().then(setThreads);
            setView({ name: 'store' });
          }}
          onOpenApp={(appId) => {
            void window.playbook.listServices().then((list) => {
              setServices(list);
              setView(list.some((x) => x.id === appId) ? { name: 'detail', serviceId: appId } : { name: 'store' });
            });
          }}
        />
      </div>
    );
  }

  const building = threads.filter((t) => !t.meta.appId);
  const engine = accounts.engine;

  return (
    <div className="app-shell">
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      {bundle && <BundlePreviewDialog preview={bundle.preview} busy={installing} onInstall={() => void handleInstallBundle()} onCancel={() => setBundle(null)} />}
      {view.name === 'store' || !selected ? (
        <>
          <header className="app-header">
            <div>
              <h1>HackMac</h1>
              <p>이 Mac, 사실 훨씬 더 많은 걸 할 수 있어요.</p>
            </div>
            <div className="header-actions">
              <button className="toggle-button is-active create-app-button" onClick={() => void handleCreate()}>
                + 앱 만들기
              </button>
              <button className="header-button install-app-button" onClick={() => void handlePickBundle()}>
                앱 파일 설치
              </button>
              <ThemeSwitch value={themePreference} onChange={handleThemeChange} />
              <button className="header-button" onClick={() => void handleCheckForUpdates()}>
                업데이트 확인
              </button>
              <button className="header-button" onClick={() => void window.playbook.openLogsFolder()}>
                로그 보기
              </button>
            </div>
          </header>
          {building.length > 0 && (
            <section className="home-section">
              <h2>만드는 중</h2>
              <div className="thread-list">
                {building.map((t) => (
                  <button key={t.meta.id} className="thread-card" onClick={() => setView({ name: 'thread', threadId: t.meta.id })}>
                    <span className="thread-card-title">{t.meta.title}</span>
                    <span className="thread-card-sub">
                      {t.busy ? '답을 쓰는 중' : '요구 정리'} · {t.meta.vendor ? VENDOR_LABEL[t.meta.vendor] : VENDOR_LABEL[engine]}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <h2 className="home-section-title">내 앱</h2>
          <ServiceGrid
            services={services}
            onActivate={handleActivate}
            onOpen={(service) => setView({ name: 'detail', serviceId: service.id })}
          />
        </>
      ) : (
        <ServiceDetail service={selected} onBack={() => setView({ name: 'store' })} onToggle={handleToggle} onExport={handleExport} />
      )}
    </div>
  );
}
