import { useState } from 'react';
import { MAX_ACCOUNTS_PER_VENDOR, VENDOR_LABEL, type AccountsView, type AccountView, type Vendor } from '../../shared/studio';
import { LoginFlow } from './LoginFlow';

interface Props {
  accounts: AccountsView;
  onAccounts: (a: AccountsView) => void;
  onClose: () => void;
}

/**
 * 계정 관리(수동 전환). 같은 회사 계정을 최대 3개까지 두고, 새 앱 만들기가 쓸 계정을 사용자가 고른다.
 * 자동 전환은 없다. 로그인은 계정마다 따로 만든 설정 폴더 안에서 공식 CLI가 한다.
 */
export function AccountsDialog({ accounts, onAccounts, onClose }: Props) {
  const [error, setError] = useState<string | null>(null);

  const apply = async (p: Promise<{ ok: true; view: AccountsView } | { ok: false; error: string }>) => {
    const r = await p;
    if (r.ok) {
      setError(null);
      onAccounts(r.view);
    } else setError(r.error);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="계정 관리">
      <div className="modal-card accounts-card">
        <div className="modal-head">
          <div>
            <h2>계정</h2>
            <p className="muted">같은 회사 계정을 최대 {MAX_ACCOUNTS_PER_VENDOR}개까지 두고, 새 앱을 만들 때 쓸 계정을 직접 골라요.</p>
          </div>
        </div>
        {error && <div className="chat-notice account-error">{error}</div>}
        {(['claude', 'codex'] as Vendor[]).map((v) => (
          <VendorSection key={v} vendor={v} list={accounts.accounts.filter((a) => a.vendor === v)} apply={apply} onError={setError} />
        ))}
        <p className="muted">
          계정을 바꿔도 이미 만들던 앱은 그 앱을 시작한 계정으로 이어져요. 만들던 앱의 계정은 그 앱 화면에서 옮길 수 있어요. 한도에 걸렸을 때 쓰세요.
        </p>
        <div className="modal-actions">
          <button className="toggle-button is-active" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

type Apply = (p: Promise<{ ok: true; view: AccountsView } | { ok: false; error: string }>) => Promise<void>;

function VendorSection({ vendor, list, apply, onError }: { vendor: Vendor; list: AccountView[]; apply: Apply; onError: (e: string | null) => void }) {
  const installed = list.some((a) => a.installed);
  return (
    <section className="account-section" data-account-vendor={vendor}>
      <h3>{VENDOR_LABEL[vendor]}</h3>
      {list.map((a) => (
        <AccountRow key={a.id} a={a} others={list} apply={apply} />
      ))}
      {installed && list.length < MAX_ACCOUNTS_PER_VENDOR && (
        <button
          className="link-button"
          data-add-account={vendor}
          onClick={() => void window.studio.addAccount(vendor).then((r) => (r.ok ? (onError(null), undefined) : onError(r.error)))}
        >
          + {VENDOR_LABEL[vendor]} 계정 추가
        </button>
      )}
      {!installed && <p className="muted">이 Mac에 설치돼 있지 않아요.</p>}
    </section>
  );
}

function AccountRow({ a, others, apply }: { a: AccountView; others: AccountView[]; apply: Apply }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(a.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dupName = a.duplicateOf ? others.find((o) => o.id === a.duplicateOf)?.label : null;
  const status = !a.installed ? '설치 안 됨' : a.loggedIn ? [a.email, a.plan].filter(Boolean).join(' · ') || '로그인됨' : '로그인이 필요해요';

  return (
    <div className={`account-row ${a.active ? 'is-active' : ''}`} data-account={a.id}>
      <div className="account-main">
        {renaming ? (
          <form
            className="login-code"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(window.studio.renameAccount(a.id, name)).then(() => setRenaming(false));
            }}
          >
            <input autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
            <button className="toggle-button is-active" type="submit" disabled={!name.trim()}>
              저장
            </button>
          </form>
        ) : (
          <span className="account-label">
            {a.label}
            {a.active && <span className="account-badge">쓰는 중</span>}
          </span>
        )}
        <span className="account-status">{status}</span>
        {dupName && <span className="account-warn">{dupName}과(와) 같은 계정이에요. 한도를 같이 쓰므로 바꿔도 소용없어요.</span>}
      </div>
      <div className="account-actions">
        {a.installed && !a.loggedIn && <LoginFlow accountId={a.id} />}
        {a.loggedIn && !a.active && (
          <button className="header-button" data-use-account={a.id} onClick={() => void apply(window.studio.setActiveAccount(a.id))}>
            이 계정으로 쓰기
          </button>
        )}
        {!a.isDefault && !renaming && (
          <button className="link-button" onClick={() => { setName(a.label); setRenaming(true); }}>
            이름 바꾸기
          </button>
        )}
        {!a.isDefault &&
          (confirmDelete ? (
            <>
              <button className="link-button account-danger" data-confirm-delete={a.id} onClick={() => void apply(window.studio.removeAccount(a.id))}>
                정말 지울게요(로그인 정보도 지워져요)
              </button>
              <button className="link-button" onClick={() => setConfirmDelete(false)}>
                아니요
              </button>
            </>
          ) : (
            <button className="link-button account-danger" data-delete-account={a.id} onClick={() => setConfirmDelete(true)}>
              삭제
            </button>
          ))}
      </div>
    </div>
  );
}
