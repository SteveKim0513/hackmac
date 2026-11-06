import { useEffect, useState } from 'react';
import type { ServiceMeta, ThemePreference } from '../shared/types';
import { VENDOR_LABEL, type AccountsView, type ThreadView } from '../shared/studio';
import { ServiceGrid } from './store/ServiceGrid';
import { ServiceDetail } from './detail/ServiceDetail';
import { ToastStack, useToasts } from './components/Toast';
import { ThemeSwitch } from './components/ThemeSwitch';
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
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    void window.playbook.listServices().then(setServices);
    void window.playbook.getThemePreference().then(setThemePreferenceState);
    void window.studio.accounts(true).then(setAccounts);
    void window.studio.threads().then(setThreads);
    const offAccounts = window.studio.onAccountsChanged(setAccounts);
    // 스레드 제목·바쁨이 바뀌면 홈 목록도 다시 읽는다(목록은 작아서 매번 다 읽어도 된다)
    const offChat = window.studio.onChat((_id, e) => {
      if (e.kind === 'message' || e.kind === 'state') void window.studio.threads().then(setThreads);
    });
    return () => {
      offAccounts();
      offChat();
    };
  }, []);

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
        />
      </div>
    );
  }

  const building = threads.filter((t) => !t.meta.appId);
  const engine = accounts.engine;

  return (
    <div className="app-shell">
      <ToastStack toasts={toasts} onDismiss={dismiss} />
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
        <ServiceDetail service={selected} onBack={() => setView({ name: 'store' })} onToggle={handleToggle} />
      )}
    </div>
  );
}
