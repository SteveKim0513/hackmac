import { useEffect, useRef, useState } from 'react';
import { VENDOR_LABEL, type Message, type ThreadMeta } from '../../shared/studio';

interface Props {
  threadId: string;
  onBack: () => void;
}

/** 계획서 7.1의 여섯 단계. 3단계(계정·대화)에서는 ① 요구 정리만 돈다 */
const STEPS = ['요구 정리', '가능성 평가', '개발', '자체 검증', '사용자 확인', '완료'];

/**
 * 스레드 하나 = 앱 하나(계획서 8.4). 왼쪽은 상태, 오른쪽은 채팅. 채팅은 언제나 오른쪽에 있고 왼쪽만 바뀐다.
 * 진행 상태는 엔진 글에서 추측하지 않는다 — 지금은 ① 단계 고정이고, 4단계에서 구조화된 진행 사건이 들어온다.
 */
export function ThreadPage({ threadId, onBack }: Props) {
  const [meta, setMeta] = useState<ThreadMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    void window.studio.thread(threadId).then((t) => {
      if (!t) return;
      setMeta(t.meta);
      setMessages(t.messages);
      setBusy(t.busy);
    });
    return window.studio.onChat((id, e) => {
      if (id !== threadId) return;
      if (e.kind === 'text' && e.phase === 'answer') setStreaming((s) => s + e.delta);
      if (e.kind === 'message') {
        setMessages((ms) => [...ms, e.message]);
        if (e.message.role === 'assistant') setStreaming('');
        // 첫 글에 제목이 붙는다
        if (e.message.role === 'user') void window.studio.thread(threadId).then((t) => t && setMeta(t.meta));
      }
      if (e.kind === 'state') setBusy(e.busy);
    });
  }, [threadId]);

  useEffect(() => {
    startedAt.current = busy ? (startedAt.current ?? Date.now()) : null;
    if (!busy) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, streaming]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setNotice(null);
    const r = await window.studio.send(threadId, text);
    if (!r.ok) {
      setNotice(r.reason);
      setDraft(text);
    }
  };

  const elapsed = startedAt.current ? Math.floor((Date.now() - startedAt.current) / 1000) : 0;

  return (
    <div className="thread-page">
      <aside className="thread-status">
        <button className="back-button" onClick={onBack}>
          ‹ 홈
        </button>
        <h1 className="thread-title">{meta?.title ?? ''}</h1>
        <p className="thread-engine">{meta?.vendor ? `${VENDOR_LABEL[meta.vendor]}로 만드는 중` : '첫 글을 보내면 시작해요'}</p>
        <ol className="step-list">
          {STEPS.map((s, i) => (
            <li key={s} className={i === 0 ? 'is-current' : ''}>
              <span className="step-num">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="thread-now">
          <span className="thread-now-label">지금</span>
          {busy ? `답을 쓰는 중 · ${elapsed}초` : messages.length ? '답을 기다리고 있어요' : '만들고 싶은 것을 말해 주세요'}
        </p>
        <p className="muted">지금은 요구사항을 함께 정리하는 데까지 해요. 실제로 앱을 만드는 단계는 다음 업데이트에서 열려요.</p>
      </aside>

      <section className="chat">
        <div className="chat-list" ref={listRef}>
          {messages.length === 0 && !streaming && (
            <div className="chat-empty">
              <p>맥에서 하고 싶은 일을 편하게 말해 주세요.</p>
              <p className="muted">예: "회의 10분 전에 화면 가운데 크게 알려 줘", "메뉴바에 내 주식 3개 시세 띄워 줘"</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={`${m.at}-${i}`} className={`bubble bubble-${m.role} ${m.error ? 'is-error' : ''}`}>
              {m.text || (m.interrupted ? '(멈췄어요)' : '')}
              {m.error && <div className="bubble-error">문제가 생겼어요: {m.error}</div>}
            </div>
          ))}
          {streaming && <div className="bubble bubble-assistant is-streaming">{streaming}</div>}
          {busy && !streaming && <div className="bubble bubble-assistant is-typing">생각하는 중…</div>}
        </div>
        {notice && <div className="chat-notice">{notice}</div>}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={draft}
            placeholder="메시지 보내기 (Enter로 보내기, Shift+Enter로 줄바꿈)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중 Enter는 글자 확정이지 보내기가 아니다
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
          />
          {busy ? (
            <button type="button" className="toggle-button" onClick={() => void window.studio.interrupt(threadId)}>
              멈추기
            </button>
          ) : (
            <button type="submit" className="toggle-button is-active" disabled={!draft.trim()}>
              보내기
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
