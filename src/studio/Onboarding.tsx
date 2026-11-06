import { useEffect, useState } from 'react';
import { VENDOR_LABEL, type AccountsView, type InstallView, type Vendor } from '../../shared/studio';
import { LoginFlow } from './LoginFlow';

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
  const [install, setInstall] = useState<InstallView | null>(null);

  // 설치 중에는 1초마다 진행 글을 받아 온다. 끝나면 accounts:changed가 카드를 "로그인 필요"로 바꾼다
  useEffect(() => {
    if (install?.state !== 'running') return;
    const t = setInterval(() => void window.studio.installState(vendor).then((s) => s && setInstall(s)), 1000);
    return () => clearInterval(t);
  }, [install?.state, vendor]);

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
      {!asking && view.installed && !view.loggedIn && <LoginFlow accountId={`${vendor}-default`} />}
      {!view.installed && !install && (
        <button className="toggle-button" onClick={() => void window.studio.installStart(vendor).then(setInstall)}>
          설치하기
        </button>
      )}
      {!view.installed && install?.state === 'running' && (
        <div className="login-panel" data-install="running">
          <p>설치하는 중이에요. 보통 1분 안에 끝나요.</p>
          {install.output && <pre>{install.output.trim().split('\n').filter(Boolean).slice(-2).join('\n')}</pre>}
        </div>
      )}
      {install?.state === 'failed' && (
        <div className="login-panel is-error" data-install="failed">
          <p>설치하지 못했어요.</p>
          {install.error && <pre>{install.error}</pre>}
          <button className="toggle-button" onClick={() => void window.studio.installStart(vendor).then(setInstall)}>
            다시 시도
          </button>
        </div>
      )}
      {!view.installed && !install && <p className="vendor-card-note">{VENDOR_LABEL[vendor]} 공식 설치 프로그램으로 이 Mac에 깔아요. 관리자 암호는 필요 없어요.</p>}
      {!ready && <p className="vendor-card-note">{PLAN_NEEDED[vendor]}</p>}
    </div>
  );
}
