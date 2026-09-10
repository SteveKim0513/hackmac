import { useEffect, useState } from 'react';
import type { ServiceMeta } from '../shared/types';
import { ServiceGrid } from './store/ServiceGrid';
import { ServiceDetail } from './detail/ServiceDetail';
import { ToastStack, useToasts } from './components/Toast';

type View = { name: 'store' } | { name: 'detail'; serviceId: string };

export default function App() {
  const [services, setServices] = useState<ServiceMeta[]>([]);
  const [view, setView] = useState<View>({ name: 'store' });
  const { toasts, push, dismiss } = useToasts();

  useEffect(() => {
    void window.playbook.listServices().then(setServices);
  }, []);

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
              <button className="header-button" onClick={() => void handleCheckForUpdates()}>
                업데이트 확인
              </button>
              <button className="header-button" onClick={() => void window.playbook.openLogsFolder()}>
                로그 보기
              </button>
            </div>
          </header>
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
