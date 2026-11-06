import { useCallback, useEffect, useState } from 'react';
import type { ServiceMeta } from '../../shared/types';
import type { MaintenanceView } from '../../shared/studio';

interface Props {
  service: ServiceMeta;
  onToggle: (service: ServiceMeta) => void;
  onExport: (service: ServiceMeta) => void;
}

export function ServiceDetail({ service, onToggle, onExport }: Props) {
  const [maint, setMaint] = useState<MaintenanceView | null>(null);
  const [maintMsg, setMaintMsg] = useState<string | null>(null);
  const refresh = useCallback(() => void window.playbook.maintenance(service.id).then(setMaint), [service.id]);
  useEffect(refresh, [refresh]);

  const apply = async (id: string) => {
    setMaintMsg('적용하는 중…');
    const r = await window.playbook.applyFix(id);
    setMaintMsg(r.ok ? '고친 버전을 적용했어요.' : `적용하지 못했어요: ${r.error}`);
    refresh();
  };

  return (
    <div className="detail-page" style={{ ['--accent' as string]: service.accentColor }}>
      <header className="detail-header">
        <div className="detail-icon">{service.icon}</div>
        <div className="detail-heading">
          <h1>{service.name}</h1>
          <p className="detail-tagline">{service.tagline}</p>
        </div>
        <div className="detail-actions">
          <button className="header-button export-app-button" onClick={() => onExport(service)}>
            내보내기
          </button>
          <button
            className={`toggle-button ${service.isActive ? 'is-active' : ''}`}
            onClick={() => onToggle(service)}
          >
            {service.isActive ? (
              <>
                <span className="status-dot" /> 켜짐
              </>
            ) : (
              '꺼짐'
            )}
          </button>
        </div>
      </header>

      {maint && (maint.pending.length > 0 || maint.history.length > 0 || maintMsg) && (
        <section className="detail-section maint-section" data-maintenance>
          <h2>유지보수</h2>
          {maintMsg && <p className="maint-msg">{maintMsg}</p>}
          {maint.pending.map((f) => (
            <div key={f.id} className="build-box is-ask" data-fix={f.id}>
              <strong>문제를 고친 버전이 있어요</strong>
              <p>{f.problem}</p>
              <p>고친 것: {f.summary}</p>
              <div className="maint-actions">
                <button className="toggle-button is-active" data-apply-fix={f.id} onClick={() => void apply(f.id)}>
                  적용
                </button>
                <button className="header-button" data-dismiss-fix={f.id} onClick={() => void window.playbook.dismissFix(f.id).then(refresh)}>
                  쓰지 않기
                </button>
              </div>
            </div>
          ))}
          {maint.history.length > 0 && (
            <details className="build-log">
              <summary>유지보수 기록 {maint.history.length}건</summary>
              <ol>
                {maint.history.slice(0, 8).map((h, i) => (
                  <li key={`${h.at}-${i}`}>
                    <span className="build-log-at">{new Date(h.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    {h.text}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}

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

      {maint && (
        <label className="maint-auto">
          <input
            type="checkbox"
            data-auto-apply
            checked={maint.autoApply}
            onChange={(e) => void window.playbook.setAutoApply(e.target.checked).then(refresh)}
          />
          앱에 문제가 생겨 HackMac이 고치면 확인 없이 바로 적용하기 (적용한 뒤에는 알려 드려요)
        </label>
      )}
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
