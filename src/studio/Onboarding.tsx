import { useEffect, useState } from 'react';
import { VENDOR_LABEL, type AccountsView, type LoginView, type Vendor } from '../../shared/studio';

interface Props {
  accounts: AccountsView;
  onAccounts: (a: AccountsView) => void;
}

const PLAN_NEEDED: Record<Vendor, string> = {
  claude: 'Claude Pro·Max·Team 구독이 필요해요',
  codex: 'ChatGPT Plus 이상 구독이 필요해요',
};

/**
 * 첫 실행 화면(계획서 2절·6.1). 로그인한 엔진이 0개면 로그인, 2개면 하나를 고른다. 1개면 이 화면이 뜨지 않는다.
 * 로그인은 공식 CLI가 브라우저를 열어 처리한다. HackMac은 비밀번호·토큰을 보지 않는다.
 */
export function Onboarding({ accounts, onAccounts }: Props) {
  const { choice, vendors } = accounts;
  const asking = choice.kind === 'ask';

  return (
    <div className="onboarding">
      <h1>{asking ? '어떤 AI로 앱을 만들까요?' : 'AI 계정에 로그인해 주세요'}</h1>
      <p className="onboarding-lead">
        {asking
          ? '두 계정 모두 로그인돼 있어요. 앞으로 새 앱은 고른 쪽으로 만들고, 설정에서 언제든 바꿀 수 있어요.'
          : 'HackMac은 이 Mac에 로그인한 구독 계정으로 앱을 만들어요. 비밀번호와 토큰은 HackMac이 보지 않아요.'}
      </p>
      <div className="onboarding-cards">
        {(['claude', 'codex'] as Vendor[]).map((v) => (
          <VendorCard key={v} vendor={v} view={vendors[v]} asking={asking} onAccounts={onAccounts} />
        ))}
      </div>
    </div>
  );
}

function VendorCard({ vendor, view, asking, onAccounts }: { vendor: Vendor; view: AccountsView['vendors'][Vendor]; asking: boolean; onAccounts: (a: AccountsView) => void }) {
  const [login, setLogin] = useState<LoginView | null>(null);
  const [code, setCode] = useState('');

  // 로그인 중에는 1초마다 CLI 출력(주소·코드 대기)을 받아 온다. 끝나면 accounts:changed가 화면을 바꾼다
  useEffect(() => {
    if (login?.state !== 'pending') return;
    const t = setInterval(() => void window.studio.loginState(vendor).then((s) => s && setLogin(s)), 1000);
    return () => clearInterval(t);
  }, [login?.state, vendor]);

  const ready = view.installed && view.loggedIn;
  const status = !view.installed ? '이 Mac에 설치돼 있지 않아요' : view.loggedIn ? (view.email ?? '로그인됨') : '로그인이 필요해요';

  return (
    <div className={`vendor-card ${ready ? 'is-ready' : ''}`} data-vendor={vendor}>
      <div className="vendor-card-name">{VENDOR_LABEL[vendor]}</div>
      <div className="vendor-card-status">{status}</div>
      {asking && ready && (
        <button className="toggle-button is-active" onClick={() => void window.studio.chooseEngine(vendor).then(onAccounts)}>
          이걸로 만들기
        </button>
      )}
      {!asking && view.installed && !view.loggedIn && !login && (
        <button className="toggle-button" onClick={() => void window.studio.loginStart(vendor).then(setLogin)}>
          로그인
        </button>
      )}
      {!view.installed && <p className="vendor-card-note">자동 설치는 곧 추가돼요. 지금은 공식 설치 안내를 따라 설치한 뒤 HackMac을 다시 열어 주세요.</p>}
      {!ready && <p className="vendor-card-note">{PLAN_NEEDED[vendor]}</p>}
      {login && login.state === 'pending' && (
        <div className="login-panel">
          <p>브라우저가 열렸어요. 로그인을 마치면 여기로 돌아와요.</p>
          {login.url && (
            <button className="link-button" onClick={() => void window.studio.openUrl(login.url!)}>
              브라우저가 안 열렸으면 여기를 눌러요
            </button>
          )}
          {login.needsCode && (
            <form
              className="login-code"
              onSubmit={(e) => {
                e.preventDefault();
                void window.studio.loginSubmit(vendor, code).then((s) => s && setLogin(s));
                setCode('');
              }}
            >
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="브라우저에 보이는 코드를 붙여넣어요" />
              <button className="toggle-button is-active" type="submit" disabled={!code.trim()}>
                확인
              </button>
            </form>
          )}
          <button className="link-button" onClick={() => void window.studio.loginCancel(vendor).then(() => setLogin(null))}>
            취소
          </button>
        </div>
      )}
      {login && login.state === 'failed' && (
        <div className="login-panel is-error">
          <p>로그인하지 못했어요.</p>
          {login.output && <pre>{login.output.trim().split('\n').slice(-3).join('\n')}</pre>}
          <button className="toggle-button" onClick={() => void window.studio.loginStart(vendor).then(setLogin)}>
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}
