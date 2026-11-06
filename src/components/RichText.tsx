import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { renderTree, type Inline } from '../../shared/markdown';
import type { GlossaryEntry } from '../../shared/glossary';

/**
 * 채팅 글을 서식 있게 그린다(굵게·목록·코드)고 모르는 단어를 풀어 준다. 글의 문자열은 전부 React 텍스트 노드로만 들어가
 * HTML로 해석되지 않는다. 용어는 점선 밑줄 — 마우스를 올리거나 누르거나 키보드로 가면 짧은 설명이 뜬다.
 */
export function RichText({ text }: { text: string }) {
  const tree = useMemo(() => renderTree(text), [text]);
  return (
    <div className="rich">
      {tree.map((b, i) => {
        if (b.t === 'p') return <p key={i}>{inline(b.c)}</p>;
        if (b.t === 'h')
          return (
            <p key={i} className="rich-h">
              {inline(b.c)}
            </p>
          );
        if (b.t === 'pre') return <pre key={i}>{b.v}</pre>;
        const items = b.items.map((it, k) => <li key={k}>{inline(it)}</li>);
        return b.t === 'ol' ? (
          <ol key={i} start={b.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      })}
    </div>
  );
}

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'b':
        return <strong key={i}>{inline(n.c)}</strong>;
      case 'i':
        return <em key={i}>{inline(n.c)}</em>;
      case 'code':
        return <code key={i}>{n.v}</code>;
      case 'term':
        return <Term key={i} entry={n.entry} label={n.v} />;
    }
  });
}

const POP_W = 280;

/** 용어 하나. 호버·포커스·클릭으로 설명 팝업을 띄운다. 팝업은 fixed라 스크롤 영역에 잘리지 않는다 */
function Term({ entry, label }: { entry: GlossaryEntry; label: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    above: boolean;
  } | null>(null);
  const [pinned, setPinned] = useState(false);

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - POP_W - 8));
    const above = r.bottom + 140 > window.innerHeight;
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const close = () => {
    setPos(null);
    setPinned(false);
  };

  // 눌러 고정한 팝업은 바깥을 누르거나 Esc, 스크롤하면 닫는다
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="term"
        data-term={entry.term}
        aria-expanded={pos !== null}
        onMouseEnter={open}
        onMouseLeave={() => !pinned && setPos(null)}
        onFocus={open}
        onBlur={() => !pinned && setPos(null)}
        onClick={() => (pinned ? close() : (open(), setPinned(true)))}
      >
        {label}
      </button>
      {pos &&
        // 문서 맨 바깥에 그린다: 굵은 글·스크롤 영역 안에 있어도 글꼴과 잘림을 물려받지 않는다
        createPortal(
          <span role="tooltip" className={`term-pop ${pos.above ? 'is-above' : ''}`} data-term-pop style={{ left: pos.left, top: pos.top, width: POP_W }}>
            <strong>{entry.term}</strong>
            {entry.text}
          </span>,
          document.body,
        )}
    </>
  );
}
