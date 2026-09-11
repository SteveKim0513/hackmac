import { useEffect, useMemo, useRef, useState } from 'react';
import type { PopupRequest, PopupResult } from '../../shared/types';
import './popup.css';

/**
 * electron/popupWindow.ts가 별도 BrowserWindow로 띄우는 화면 — 서비스
 * 스크립트가 osascript `choose from list`/`display dialog` 대신 부르는
 * 팝업의 실제 모습이다 (resources/bin/hackmac-popup 참고). 창 하나에 요청
 * 하나만 오므로 상태는 이 컴포넌트 안에서 전부 끝낸다.
 */
export function PopupApp() {
  const [request, setRequest] = useState<PopupRequest | null>(null);

  useEffect(() => {
    window.hackmacPopup.onInit(setRequest);
    window.hackmacPopup.ready();
  }, []);

  if (!request) return null;

  if (request.kind === 'select') return <SelectPopup request={request} onResolve={window.hackmacPopup.resolve} />;
  if (request.kind === 'prompt') return <PromptPopup request={request} onResolve={window.hackmacPopup.resolve} />;
  return <ConfirmPopup request={request} onResolve={window.hackmacPopup.resolve} />;
}

type Resolver = (result: PopupResult) => void;

function SelectPopup({ request, onResolve }: { request: Extract<PopupRequest, { kind: 'select' }>; onResolve: Resolver }) {
  const defaultIndex = useMemo(() => {
    const i = request.defaultItem ? request.items.indexOf(request.defaultItem) : -1;
    return i >= 0 ? i : 0;
  }, [request]);
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const cancel = () => onResolve({ ok: false, value: null });
  const choose = (i: number) => {
    if (request.items.length === 0) return;
    onResolve({ ok: true, value: request.items[i] });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancel();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, request.items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        choose(activeIndex);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, request.items.length]);

  return (
    <div className="popup-card">
      <div className="popup-header">
        <p className="popup-title">{request.title}</p>
        <p className="popup-prompt">{request.prompt}</p>
      </div>
      {request.items.length === 0 ? (
        <div className="popup-empty">고를 항목이 없어요</div>
      ) : (
        <ul className="popup-list">
          {request.items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className={`popup-row ${i === activeIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(i)}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
      <div className="popup-actions">
        <button className="popup-btn" onClick={cancel}>
          {request.cancelLabel}
        </button>
        <button className="popup-btn primary" disabled={request.items.length === 0} onClick={() => choose(activeIndex)}>
          {request.okLabel}
        </button>
      </div>
    </div>
  );
}

function PromptPopup({ request, onResolve }: { request: Extract<PopupRequest, { kind: 'prompt' }>; onResolve: Resolver }) {
  const [value, setValue] = useState(request.defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancel = () => onResolve({ ok: false, value: null });
  const submit = () => onResolve({ ok: true, value });

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="popup-card">
      <div className="popup-header">
        <p className="popup-title">{request.title}</p>
        <p className="popup-prompt">{request.prompt}</p>
      </div>
      <input
        ref={inputRef}
        className="popup-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') cancel();
        }}
      />
      <div className="popup-actions">
        <button className="popup-btn" onClick={cancel}>
          {request.cancelLabel}
        </button>
        <button className="popup-btn primary" onClick={submit}>
          {request.okLabel}
        </button>
      </div>
    </div>
  );
}

function ConfirmPopup({ request, onResolve }: { request: Extract<PopupRequest, { kind: 'confirm' }>; onResolve: Resolver }) {
  // 취소할 게 없는 순수 정보 표시(04-status.sh)는 cancelLabel을 빈 문자열로
  // 보낸다 — 그럴 땐 취소 버튼 자체를 숨기고, Esc도 "닫기"로만 동작한다.
  const hasCancel = request.cancelLabel.length > 0;
  const cancel = () => onResolve({ ok: false, value: null });
  const confirm = () => onResolve({ ok: true, value: null });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (hasCancel ? cancel : confirm)();
      if (e.key === 'Enter') confirm();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCancel]);

  return (
    <div className="popup-card">
      <div className="popup-header">
        <p className="popup-title">{request.title}</p>
      </div>
      <div className="popup-body">
        <p className="popup-message">{request.prompt}</p>
      </div>
      <div className="popup-actions">
        {hasCancel && (
          <button className="popup-btn" onClick={cancel}>
            {request.cancelLabel}
          </button>
        )}
        <button className="popup-btn primary" onClick={confirm}>
          {request.okLabel}
        </button>
      </div>
    </div>
  );
}
