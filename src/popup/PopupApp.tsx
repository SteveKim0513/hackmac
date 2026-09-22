import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
  if (request.kind === 'date') return <DatePopup request={request} onResolve={window.hackmacPopup.resolve} />;
  if (request.kind === 'status') return <StatusPopup request={request} />;
  return <ConfirmPopup request={request} onResolve={window.hackmacPopup.resolve} />;
}

type Resolver = (result: PopupResult) => void;

function SelectPopup({ request, onResolve }: { request: Extract<PopupRequest, { kind: 'select' }>; onResolve: Resolver }) {
  const defaultIndex = useMemo(() => {
    const i = request.defaultItem ? request.items.findIndex((item) => item.label === request.defaultItem) : -1;
    return i >= 0 ? i : 0;
  }, [request]);
  const [activeIndex, setActiveIndex] = useState(defaultIndex);
  const cancel = () => onResolve({ ok: false, value: null });
  const choose = (i: number) => {
    if (request.items.length === 0) return;
    onResolve({ ok: true, value: request.items[i].label });
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
          {request.items.map((item, i, items) => {
            const showHeader = item.group && item.group !== items[i - 1]?.group;
            return (
              <Fragment key={`${item.label}-${i}`}>
                {showHeader && <li className="popup-group-header">{item.group}</li>}
                <li
                  className={`popup-row ${i === activeIndex ? 'is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => choose(i)}
                >
                  {item.label}
                </li>
              </Fragment>
            );
          })}
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

const WEEKDAY_LABELS_KR = ['일', '월', '화', '수', '목', '금', '토'];

function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || new Date().getFullYear(), (m || 1) - 1, d || 1);
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 달력 그리드 한 칸(일요일 시작, 6주 고정) — 이전/다음 달로 넘어간 칸은
 * null로 비워 이번 달 날짜만 보여준다. */
function buildMonthGrid(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length < 42) cells.push(null);
  return cells;
}

function DatePopup({ request, onResolve }: { request: Extract<PopupRequest, { kind: 'date' }>; onResolve: Resolver }) {
  const initial = useMemo(() => (request.defaultValue ? parseISODate(request.defaultValue) : new Date()), [request]);
  const [activeDate, setActiveDate] = useState(initial);
  const [viewMonth, setViewMonth] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));

  const cancel = () => onResolve({ ok: false, value: null });
  const choose = (d: Date) => onResolve({ ok: true, value: toISODate(d) });
  const shiftMonth = (delta: number) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const moveActive = (deltaDays: number) => {
    setActiveDate((d) => {
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + deltaDays);
      setViewMonth((m) => (m.getFullYear() === next.getFullYear() && m.getMonth() === next.getMonth() ? m : new Date(next.getFullYear(), next.getMonth(), 1)));
      return next;
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancel();
      } else if (e.key === 'Enter') {
        choose(activeDate);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveActive(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveActive(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveActive(-7);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveActive(7);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDate]);

  const cells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const markedSet = useMemo(() => new Set(request.markedDates), [request]);
  const activeISO = toISODate(activeDate);
  const todayISO = toISODate(new Date());

  return (
    <div className="popup-card">
      <div className="popup-header">
        <p className="popup-title">{request.title}</p>
        <p className="popup-prompt">{request.prompt}</p>
      </div>
      <div className="popup-calendar">
        <div className="popup-calendar-nav">
          <button type="button" className="popup-calendar-navbtn" onClick={() => shiftMonth(-1)} aria-label="이전 달">
            ‹
          </button>
          <span className="popup-calendar-month">
            {viewMonth.getFullYear()}년 {viewMonth.getMonth() + 1}월
          </span>
          <button type="button" className="popup-calendar-navbtn" onClick={() => shiftMonth(1)} aria-label="다음 달">
            ›
          </button>
        </div>
        <div className="popup-calendar-weekdays">
          {WEEKDAY_LABELS_KR.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="popup-calendar-grid">
          {cells.map((day, i) => {
            if (!day) return <span key={i} className="popup-calendar-cell is-empty" />;
            const iso = toISODate(day);
            return (
              <button
                key={i}
                type="button"
                className={`popup-calendar-cell ${iso === activeISO ? 'is-active' : ''} ${iso === todayISO ? 'is-today' : ''}`}
                onMouseEnter={() => setActiveDate(day)}
                onClick={() => choose(day)}
              >
                {day.getDate()}
                {markedSet.has(iso) && <span className="popup-calendar-dot" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="popup-actions">
        <button className="popup-btn" onClick={cancel}>
          {request.cancelLabel}
        </button>
        <button className="popup-btn primary" onClick={() => choose(activeDate)}>
          {request.okLabel}
        </button>
      </div>
    </div>
  );
}

/** electron/services.ts가 단축키 콜백에서 스크립트를 spawn하기 직전에
 * 직접 띄우는 "지금 실행 중" 표시 — 사용자가 답할 버튼도 취소도 없고,
 * electron/popupWindow.ts의 showRunningStatus/hideRunningStatus가 창
 * 자체를 프로그램적으로 열고 닫으므로 여기선 onResolve를 아예 호출하지
 * 않는다. */
function StatusPopup({ request }: { request: Extract<PopupRequest, { kind: 'status' }> }) {
  return (
    <div className="popup-card popup-status">
      <span className="popup-spinner" aria-hidden="true" />
      <p className="popup-status-text">{request.prompt}</p>
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
