import { useEffect, useRef, useState } from 'react';
import type { ThemePreference } from '../../shared/types';
import { ThemeSwitch } from './ThemeSwitch';

/**
 * 툴바의 "더 보기": 가끔 쓰는 것(테마, 업데이트 확인, 로그)을 한곳에 접는다. 툴바에는 그 화면의 주 행동만 남긴다(app-ui-basics G1).
 * 바깥을 누르거나 Esc를 누르면 닫힌다.
 */
export function MoreMenu({
  theme,
  onTheme,
  onCheckUpdates,
  onOpenLogs,
}: {
  theme: ThemePreference;
  onTheme: (p: ThemePreference) => void;
  onCheckUpdates: () => void;
  onOpenLogs: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className="more-menu" ref={ref}>
      <button
        className="header-button more-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="더 보기"
        title="더 보기"
        onClick={() => setOpen((x) => !x)}
      >
        <svg width="16" height="4" viewBox="0 0 16 4" aria-hidden="true">
          <circle cx="2" cy="2" r="1.6" fill="currentColor" />
          <circle cx="8" cy="2" r="1.6" fill="currentColor" />
          <circle cx="14" cy="2" r="1.6" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="more-menu-pop" role="menu">
          <div className="more-menu-label">화면</div>
          <ThemeSwitch value={theme} onChange={onTheme} />
          <div className="more-menu-sep" />
          <button
            role="menuitem"
            className="more-menu-item"
            onClick={() => {
              setOpen(false);
              onCheckUpdates();
            }}
          >
            업데이트 확인
          </button>
          <button
            role="menuitem"
            className="more-menu-item"
            onClick={() => {
              setOpen(false);
              onOpenLogs();
            }}
          >
            로그 보기
          </button>
        </div>
      )}
    </div>
  );
}
