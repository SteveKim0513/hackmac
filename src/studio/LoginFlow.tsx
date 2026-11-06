import { useEffect, useState } from 'react';
import type { LoginView } from '../../shared/studio';

interface Props {
  /** 계정 id(기본 계정은 'claude-default' 등) */
  accountId: string;
  /** 시작 버튼 글 */
  startLabel?: string;
}

/**
 * 로그인 한 계정분: 버튼 → 브라우저가 열림(공식 CLI) → 주소·코드 붙여넣기 → 실패면 다시 시도.
 * 끝나면 메인이 accounts:changed를 보내 화면을 바꾼다. 첫 실행 화면과 계정 관리 창이 같이 쓴다.
 */
export function LoginFlow({ accountId, startLabel = '로그인' }: Props) {
  const [login, setLogin] = useState<LoginView | null>(null);
  const [code, setCode] = useState('');

  // 로그인 중에는 1초마다 CLI 출력(주소·코드 대기)을 받아 온다
  useEffect(() => {
    if (login?.state !== 'pending') return;
    const t = setInterval(() => void window.studio.loginState(accountId).then((s) => s && setLogin(s)), 1000);
    return () => clearInterval(t);
  }, [login?.state, accountId]);

  const start = () => void window.studio.loginStart(accountId).then(setLogin);

  if (!login) {
    return (
      <button className="toggle-button" data-login-start={accountId} onClick={start}>
        {startLabel}
      </button>
    );
  }
  if (login.state === 'pending') {
    return (
      <div className="login-panel" data-login="pending">
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
              void window.studio.loginSubmit(accountId, code).then((s) => s && setLogin(s));
              setCode('');
            }}
          >
            <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="브라우저에 보이는 코드를 붙여넣어요" />
            <button className="toggle-button is-active" type="submit" disabled={!code.trim()}>
              확인
            </button>
          </form>
        )}
        <button className="link-button" onClick={() => void window.studio.loginCancel(accountId).then(() => setLogin(null))}>
          취소
        </button>
      </div>
    );
  }
  if (login.state === 'failed') {
    return (
      <div className="login-panel is-error" data-login="failed">
        <p>로그인하지 못했어요.</p>
        {login.output && <pre>{login.output.trim().split('\n').slice(-3).join('\n')}</pre>}
        <button className="toggle-button" onClick={start}>
          다시 시도
        </button>
      </div>
    );
  }
  return null;
}
