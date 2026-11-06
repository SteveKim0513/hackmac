import { useEffect, useRef, useState } from 'react';
import type { ServiceMeta, ThemePreference } from '../shared/types';
import { ServiceGrid } from './store/ServiceGrid';
import { ServiceDetail } from './detail/ServiceDetail';
import { ToastStack, useToasts } from './components/Toast';
import { ThemeSwitch } from './components/ThemeSwitch';

type View = { name: 'store' } | { name: 'detail'; serviceId: string };

export default function App() {
  const [services, setServices] = useState<ServiceMeta[]>([]);
  const [view, setView] = useState<View>({ name: 'store' });
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>('system');
  const [scrolled, setScrolled] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    void window.playbook.listServices().then(setServices);
    void window.playbook.getThemePreference().then(setThemePreferenceState);
  }, []);

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

  const isDetail = view.name === 'detail' && selected !== null;

  // 화면을 바꾸면 새 화면은 맨 위부터 보여야 한다 — 스크롤 컨테이너가
  // 창 전체가 아니라 .app-content 하나라 직접 되돌린다.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    setScrolled(false);
  }, [view]);

  return (
    <div className="app-shell">
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      <div className={`titlebar ${scrolled ? 'is-scrolled' : ''}`}>
        {isDetail && (
          <>
            <button
              className="titlebar-back"
              onClick={() => setView({ name: 'store' })}
              aria-label="스토어로 돌아가기"
              title="스토어로 돌아가기"
            >
              <svg width="9" height="15" viewBox="0 0 9 15" aria-hidden="true">
                <path d="M7.5 1.5 1.5 7.5l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="titlebar-title">{selected.name}</span>
          </>
        )}
        <div className="titlebar-spacer" />
        <div className="header-actions">
          <ThemeSwitch value={themePreference} onChange={handleThemeChange} />
          <button className="header-button" onClick={() => void handleCheckForUpdates()}>
            업데이트 확인
          </button>
          <button className="header-button" onClick={() => void window.playbook.openLogsFolder()}>
            로그 보기
          </button>
        </div>
      </div>
      <main className="app-content" ref={contentRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        {isDetail ? (
          <ServiceDetail service={selected} onToggle={handleToggle} />
        ) : (
          <>
            <header className="app-header">
              <div>
                <h1>HackMac</h1>
                <p>이 Mac, 사실 훨씬 더 많은 걸 할 수 있어요.</p>
              </div>
            </header>
            <ServiceGrid
              services={services}
              onActivate={handleActivate}
              onOpen={(service) => setView({ name: 'detail', serviceId: service.id })}
            />
          </>
        )}
      </main>
    </div>
  );
}
