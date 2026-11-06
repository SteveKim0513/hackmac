import type { ServiceMeta } from '../../shared/types';

interface CardProps {
  service: ServiceMeta;
  onActivate: (service: ServiceMeta) => void;
  onOpen: (service: ServiceMeta) => void;
}

interface Props {
  services: ServiceMeta[];
  onActivate: (service: ServiceMeta) => void;
  onOpen: (service: ServiceMeta) => void;
}

export function ServiceGrid({ services, onActivate, onOpen }: Props) {
  if (services.length === 0) {
    return (
      <div className="empty-state">
        <p>아직 등록된 서비스가 없어요.</p>
      </div>
    );
  }

  return (
    <div className="service-grid">
      {services.map((service, i) => (
        <ServiceCard key={service.id} service={service} index={i} onActivate={onActivate} onOpen={onOpen} />
      ))}
    </div>
  );
}

function ServiceCard({ service, index, onActivate, onOpen }: CardProps & { index: number }) {
  const handleClick = () => {
    if (service.isActive) onOpen(service);
    else onActivate(service);
  };

  return (
    <div className="service-card-wrap" style={{ ['--i' as string]: index }}>
      <button
        className={`service-card ${service.isActive ? 'is-active' : ''}`}
        style={{ ['--accent' as string]: service.accentColor, ['--i' as string]: index }}
        onClick={handleClick}
      >
        <div className="service-card-icon">{service.icon}</div>
        <div className="service-card-name">{service.name}</div>
        <div className="service-card-tagline">{service.tagline}</div>
        <div className="service-card-status">
          {service.isActive ? (
            <span className="status-pill status-pill-active">
              <span className="status-dot" />
              활성화됨 · 눌러서 자세히
            </span>
          ) : (
            <span className="status-pill">
              <span className="status-dot" />
              눌러서 켜기
            </span>
          )}
        </div>
      </button>
      {/* 꺼진 앱도 설정·수정·내보내기를 할 수 있어야 한다(카드를 누르면 켜지기만 하므로 상세로 가는 길을 따로 둔다) */}
      <button
        className="card-details"
        data-card-details={service.id}
        aria-label={`${service.name} 자세히·설정`}
        title="자세히·설정"
        onClick={() => onOpen(service)}
      >
        설정
      </button>
    </div>
  );
}
