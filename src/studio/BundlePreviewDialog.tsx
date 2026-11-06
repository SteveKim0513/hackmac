import type { BundlePreview } from '../../shared/studio';

interface Props {
  preview: BundlePreview;
  busy: boolean;
  onInstall: () => void;
  onCancel: () => void;
}

/**
 * 받은 앱 파일의 설치 확인(계획서 9.1 3·9.5). 아무것도 실행하지 않은 상태에서 선언 요약만 보여 주고,
 * 사용자가 확인해야 설치한다. 선언은 정직한 앱만 막아 줄 뿐이라 "아는 사람의 파일만" 경고를 늘 붙인다.
 */
export function BundlePreviewDialog({ preview: p, busy, onInstall, onCancel }: Props) {
  const blocked = p.missing.length > 0;
  const perms: string[] = [
    ...p.permissions.automation.map((a) => `${a} 앱을 조작해요`),
    ...p.permissions.network.map((h) => `인터넷(${h})에 접속해요`),
    ...(p.permissions.accessibility ? ['키 입력을 대신 눌러요(손쉬운 사용 권한)'] : []),
    ...(p.permissions.fullDiskAccess ? ['디스크 전체를 읽어요(전체 디스크 접근 권한)'] : []),
  ];
  const triggers = [
    ...(p.triggers.hotkeys ? [`단축키 ${p.triggers.hotkeys}개`] : []),
    ...(p.triggers.resident ? ['켜져 있는 동안 계속 실행'] : []),
    ...(p.triggers.schedules ? [`정해진 시각에 실행 ${p.triggers.schedules}개`] : []),
    ...(p.triggers.login ? ['HackMac이 켜질 때 실행'] : []),
  ];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="앱 설치 확인">
      <div className="modal-card" data-bundle-preview={p.id}>
        <div className="modal-head">
          <div className="detail-icon">{p.icon}</div>
          <div>
            <h2>{p.name}</h2>
            <p className="muted">
              {p.author} 님이 만든 앱 · 버전 {p.appVersion}
              {p.installedVersion && ` · 지금은 ${p.installedVersion} 버전이 깔려 있어요`}
            </p>
          </div>
        </div>
        <p className="modal-tagline">{p.tagline.replace(/\{hotkey:[a-z0-9-]+\}/g, '단축키')}</p>

        {blocked && (
          <div className="build-box is-verdict-impossible">
            <strong>이 HackMac으로는 설치할 수 없어요</strong>
            <p>이 앱이 쓰는 기능이 아직 없어요. HackMac을 업데이트한 뒤 다시 시도해 주세요.</p>
            <ul>
              {p.missing.map((m) => (
                <li key={m.name}>{m.name}</li>
              ))}
            </ul>
          </div>
        )}

        <h3>이 앱이 하는 일</h3>
        <ul className="modal-list">
          {triggers.map((t) => (
            <li key={t}>{t}</li>
          ))}
          {perms.length === 0 && <li>다른 앱이나 인터넷을 쓰지 않아요</li>}
          {perms.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {(p.settings.length > 0 || p.secrets.length > 0) && (
          <p className="muted">
            설치한 뒤 직접 입력해야 해요: {[...p.settings, ...p.secrets].join(', ')}. 보낸 사람의 설정값과 비밀값은 따라오지 않아요.
          </p>
        )}
        {p.references.length > 0 && (
          <details className="build-log">
            <summary>참고한 오픈소스 {p.references.length}개</summary>
            <ol>
              {p.references.map((r) => (
                <li key={r.repo}>
                  {r.repo} · {r.license} · {r.borrowed}
                </li>
              ))}
            </ol>
          </details>
        )}

        <p className="modal-warning">
          {p.signed ? '' : '이 앱은 서명이 없어요. '}
          앱 파일을 설치하는 건 남이 만든 프로그램을 내 Mac에서 실행하는 일이에요. 아는 사람이 보낸 파일만 설치하세요.
        </p>

        <div className="modal-actions">
          <button className="header-button" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button className="toggle-button is-active" onClick={onInstall} disabled={busy || blocked}>
            {busy ? '설치하는 중…' : p.installedVersion ? '새 버전으로 설치' : '설치'}
          </button>
        </div>
      </div>
    </div>
  );
}
