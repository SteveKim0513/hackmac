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

  const selected = view.name === 'detail' ? services.find((s) => s.id === view.serviceId) ?? null : null;

  return (
    <div className="app-shell">
      <ToastStack toasts={toasts} onDismiss={dismiss} />
      {view.name === 'store' || !selected ? (
        <>
          <header className="app-header">
            <div>
              <h1>HackMac</h1>
              <p>미리 만들어둔 단축키+스크립트 서비스를 앱처럼 켜고 꺼요.</p>
            </div>
            <button className="logs-button" onClick={() => void window.playbook.openLogsFolder()}>
              로그 보기
            </button>
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
