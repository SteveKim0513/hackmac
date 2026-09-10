import type { ServiceMeta } from '../../shared/types';

interface Props {
  service: ServiceMeta;
  onBack: () => void;
  onToggle: (service: ServiceMeta) => void;
}

export function ServiceDetail({ service, onBack, onToggle }: Props) {
  return (
    <div className="detail-page" style={{ ['--accent' as string]: service.accentColor }}>
      <button className="back-button" onClick={onBack}>
        ← 스토어로
      </button>

      <header className="detail-header">
        <div className="detail-icon">{service.icon}</div>
        <div className="detail-heading">
          <h1>{service.name}</h1>
          <p className="detail-tagline">{service.tagline}</p>
        </div>
        <button
          className={`toggle-button ${service.isActive ? 'is-active' : ''}`}
          onClick={() => onToggle(service)}
        >
          {service.isActive ? '● 켜짐' : '꺼짐'}
        </button>
      </header>

      <section className="detail-section">
        <h2>이게 뭔가요</h2>
        {service.whatItIs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </section>

      <section className="detail-section">
        <h2>차별점</h2>
        <ul>
          {service.differentiators.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h2>왜 강력한가</h2>
        <ul>
          {service.strengths.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h2>사용법</h2>
        <ol>
          {service.usage.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </section>

      <section className="detail-section">
        <h2>단축키</h2>
        {service.shortcuts.length === 0 ? (
          <p className="muted">등록된 단축키가 없어요.</p>
        ) : (
          <table className="shortcut-table">
            <thead>
              <tr>
                <th>단축키</th>
                <th>기능</th>
                <th>설명</th>
              </tr>
            </thead>
            <tbody>
              {service.shortcuts.map((s) => (
                <tr key={s.id}>
                  <td>
                    <kbd>{formatHotkey(s.hotkey)}</kbd>
                    {s.hotkeyError && <div className="hotkey-error">{s.hotkeyError}</div>}
                  </td>
                  <td>{s.name}</td>
                  <td>{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!service.isActive && <p className="muted">서비스를 켜야 단축키가 실제로 동작해요.</p>}
      </section>
    </div>
  );
}

function formatHotkey(hotkey: string | null): string {
  if (!hotkey) return '—';
  return hotkey
    .replace(/CommandOrControl/g, '⌘')
    .replace(/Command/g, '⌘')
    .replace(/Control/g, '⌃')
    .replace(/Option|Alt/g, '⌥')
    .replace(/Shift/g, '⇧')
    .replace(/\+/g, ' ');
}
