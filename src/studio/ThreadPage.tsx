import { useEffect, useRef, useState } from 'react';
import { RichText } from '../components/RichText';
import { VENDOR_LABEL, type AccountsView, type BuildState, type Message, type RecipeView, type ReqStatus, type ThreadMeta } from '../../shared/studio';
import { RecipeDialog } from './RecipeDialog';

interface Props {
  threadId: string;
  onBack: () => void;
  onOpenApp: (appId: string) => void;
}

/** 계획서 7.1의 여섯 단계(modules/build/progress.ts STEPS와 같다) */
const STEPS = ['요구 정리', '가능성 평가', '개발', '자체 검증', '사용자 확인', '완료'];
const REQ_LABEL: Record<ReqStatus, { mark: string; text: string }> = {
  todo: { mark: '○', text: '대기' },
  passed: { mark: '✓', text: '시험 통과' },
  failed: { mark: '✕', text: '시험 실패' },
  missing: { mark: '△', text: '시험 없음' },
  manual: { mark: '◇', text: '직접 확인' },
};
const VERDICT_LABEL = { possible: '가능', conditional: '조건부 가능', impossible: '불가능' } as const;

/**
 * 스레드 하나 = 앱 하나(계획서 8.4). 왼쪽은 상태, 오른쪽은 채팅. 채팅은 언제나 오른쪽에 있고 왼쪽만 바뀐다.
 * 진행 상태는 엔진 글에서 추측하지 않는다 — 지금은 ① 단계 고정이고, 4단계에서 구조화된 진행 사건이 들어온다.
 */
export function ThreadPage({ threadId, onBack, onOpenApp }: Props) {
  const [meta, setMeta] = useState<ThreadMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountsView | null>(null);
  const [recipe, setRecipe] = useState<Extract<RecipeView, { ok: true }> | null>(null);
  const [recipeBusy, setRecipeBusy] = useState(false);
  const [build, setBuild] = useState<BuildState | null>(null);
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
    void window.studio.build(threadId).then(setBuild);
    void window.studio.accounts().then(setAccounts);
    const offAccounts = window.studio.onAccountsChanged(setAccounts);
    const offBuild = window.studio.onBuild((id, st) => id === threadId && setBuild(st));
    const offChat = window.studio.onChat((id, e) => {
      if (id !== threadId) return;
      if (e.kind === 'text' && e.phase === 'answer') setStreaming((s) => s + e.delta);
      if (e.kind === 'message') {
        setMessages((ms) => [...ms, e.message]);
        if (e.message.role === 'assistant') setStreaming('');
        // 첫 글에 제목이 붙는다
        // 첫 글에 제목이 붙고, 계정을 옮기면 알림 글이 온다 — 둘 다 메타가 바뀐다
        if (e.message.role === 'user' || e.message.role === 'notice') void window.studio.thread(threadId).then((t) => t && setMeta(t.meta));
      }
      if (e.kind === 'state') setBusy(e.busy);
    });
    return () => {
      offAccounts();
      offBuild();
      offChat();
    };
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

  const makeRecipe = async () => {
    setRecipeBusy(true);
    setNotice(null);
    const r = await window.studio.makeRecipe(threadId);
    setRecipeBusy(false);
    if (r.ok) setRecipe(r);
    else setNotice(r.error);
  };

  const elapsed = startedAt.current ? Math.floor((Date.now() - startedAt.current) / 1000) : 0;

  const manualRubric = build?.rubric?.items.filter((x) => x.how === 'manual') ?? [];

  return (
    <div className="thread-page">
      {recipe && <RecipeDialog recipe={recipe} onClose={() => setRecipe(null)} />}
      <aside className="thread-status">
        <button className="back-button" onClick={onBack}>
          ‹ 홈
        </button>
        <h1 className="thread-title">{meta?.title ?? ''}</h1>
        <p className="thread-engine">{meta?.vendor ? `${VENDOR_LABEL[meta.vendor]}로 만드는 중` : '첫 글을 보내면 시작해요'}</p>
        {meta?.vendor && accounts && (
          <label className="thread-account">
            쓰는 계정
            <select
              data-thread-account
              value={meta.account ?? accounts.accounts.find((a) => a.vendor === meta.vendor && a.active)?.id ?? ''}
              disabled={busy}
              onChange={(e) =>
                void window.studio.setThreadAccount(threadId, e.target.value).then((r) => {
                  setNotice(r.ok ? null : r.reason);
                  void window.studio.thread(threadId).then((t) => t && setMeta(t.meta));
                })
              }
            >
              {accounts.accounts
                .filter((a) => a.vendor === meta.vendor && (a.loggedIn || a.id === meta.account))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                    {a.email ? ` · ${a.email}` : ''}
                  </option>
                ))}
            </select>
          </label>
        )}
        {messages.some((m) => m.role === 'user') && (
          <button className="header-button recipe-button" data-make-recipe disabled={busy || recipeBusy} onClick={() => void makeRecipe()}>
            {recipeBusy ? '레시피 만드는 중…' : '레시피 만들기'}
          </button>
        )}
        <ol className="step-list">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const step = build?.step ?? 1;
            return (
              <li key={label} className={n === step ? 'is-current' : n < step ? 'is-done' : ''}>
                <span className="step-num">{n < step ? '✓' : n}</span>
                {label}
              </li>
            );
          })}
        </ol>
        {build?.installed ? (
          <div className="build-box is-done">
            <strong>내 앱에 들어갔어요</strong>
            <p>홈의 내 앱에서 켜면 바로 동작해요.</p>
            {build.audit && (
              <p className="honest-line" data-honest>
                확인한 것 {build.audit.items.filter((x) => x.met).length}개(다른 AI가 코드에서 근거를 찾음)
                {manualRubric.length > 0 ? ` · 직접 확인할 것 ${manualRubric.length}개` : ''}
              </p>
            )}
            {manualRubric.length > 0 && (
              <ul className="honest-manual" data-manual-checks>
                {manualRubric.map((m) => (
                  <li key={m.id}>{m.criterion}</li>
                ))}
              </ul>
            )}
            <button className="toggle-button is-active" onClick={() => onOpenApp(build.installed!.appId)}>
              앱 보러 가기
            </button>
          </div>
        ) : (
          <p className="thread-now">
            <span className="thread-now-label">지금</span>
            {build?.now ?? (busy ? `답을 쓰는 중 · ${elapsed}초` : messages.length ? '답을 기다리고 있어요' : '만들고 싶은 것을 말해 주세요')}
            {busy && build?.now ? ` · ${elapsed}초` : ''}
          </p>
        )}
        {build?.pipeline?.status === 'running' && build.role && (
          <p className="thread-role" data-role={build.role.id}>
            <span className="thread-now-label">담당</span>
            {build.role.label}
            {build.role.round ? ` · ${build.role.round}번째 보완` : ''}
          </p>
        )}
        {build?.pipeline?.status === 'failed' && (
          <div className="build-box is-fail" data-pipeline-failed>
            <strong>만들지 못했어요</strong>
            <p>{build.pipeline.reason}</p>
          </div>
        )}
        {build?.ask && (
          <div className="build-box is-ask">
            <strong>확인이 필요해요</strong>
            <p>{build.ask}</p>
          </div>
        )}
        {build && build.requirements.length > 0 && (
          <div className="req-list">
            <h2>요구사항</h2>
            {build.requirements.map((r) => (
              <div key={r.id} className={`req-row is-${r.status}`} title={r.manual ?? undefined}>
                <span className="req-mark">{REQ_LABEL[r.status].mark}</span>
                <span className="req-text">{r.text}</span>
                <span className="req-status">{REQ_LABEL[r.status].text}</span>
                {r.accept.length > 0 && (
                  <ul className="req-accept">
                    {r.accept.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        {build?.verdict && (
          <div className={`build-box is-verdict-${build.verdict.kind}`}>
            <strong>가능성 평가: {VERDICT_LABEL[build.verdict.kind]}</strong>
            <p>{build.verdict.summary}</p>
            {build.verdict.conditions.length > 0 && (
              <ul>
                {build.verdict.conditions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {build?.rubric && (
          <details className="build-box rubric-box" data-rubric open={!build.audit}>
            <summary>
              <strong>합격 기준 {build.rubric.items.length}개</strong>
              <span className="muted"> · 만들기 전에 {build.rubric.by}가 먼저 정함</span>
            </summary>
            <ul>
              {build.rubric.items.map((x) => {
                const goal = build.audit?.items.find((a) => a.id === x.req);
                return (
                  <li key={x.id} data-rubric-item={x.id}>
                    <span className="rubric-how">{x.how === 'auto' ? '시험' : '직접'}</span>
                    {x.criterion}
                    {goal && <span className={`rubric-mark ${goal.met ? 'is-met' : 'is-unmet'}`}>{goal.met ? ' ✓' : ' ✗'}</span>}
                  </li>
                );
              })}
            </ul>
          </details>
        )}
        {build?.experiments && build.experiments.length > 0 && (
          <div className="build-box" data-experiments>
            <strong>후보를 실제로 돌려 고른 것</strong>
            <ul>
              {build.experiments.map((x) => (
                <li key={x.question}>
                  {x.question}: {x.winner ? `${x.winner}이(가) 이김` : '합격한 후보 없음'}
                  <span className="muted"> ({x.runs.map((r) => `${r.name} ${r.ok ? `${r.ms}ms` : '불합격'}`).join(' · ')})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {build?.audit && (
          <div className={`build-box audit-box ${build.audit.ok ? 'is-met' : 'is-unmet'}`} data-audit>
            <strong>
              목표 확인 {build.audit.items.filter((x) => x.met).length}/{build.audit.items.length}
            </strong>
            <span className="muted"> · {build.audit.by}가 코드를 읽고 확인</span>
            <ul>
              {build.audit.items.map((x) => (
                <li key={x.id} className={x.met ? 'is-met' : 'is-unmet'} data-audit-item={x.id} title={x.met ? x.evidence : x.gap}>
                  <span className="audit-mark">{x.met ? '✓' : '✗'}</span>
                  <span>
                    {x.kind === 'goal' ? x.label : `서비스 기준 · ${x.label}`}
                    <span className="audit-why">{x.met ? x.evidence : x.gap}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {build && build.log.length > 0 && (
          <details className="build-log">
            <summary>자세한 기록</summary>
            <ol>
              {build.log.slice(-60).map((l, i) => (
                <li key={`${l.at}-${i}`}>
                  <span className="build-log-at">{l.at ? new Date(l.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                  {l.text}
                </li>
              ))}
            </ol>
          </details>
        )}
      </aside>

      <section className="chat">
        <div className="chat-list" ref={listRef}>
          {messages.length === 0 && !streaming && (
            <div className="chat-empty">
              <p>맥에서 하고 싶은 일을 편하게 말해 주세요.</p>
              <p className="muted">다른 사람이 보낸 레시피가 있으면 여기에 그대로 붙여넣으세요.</p>
              <p className="muted">예: "회의 10분 전에 화면 가운데 크게 알려 줘", "메뉴바에 내 주식 3개 시세 띄워 줘"</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={`${m.at}-${i}`} className={`bubble bubble-${m.role} ${m.error ? 'is-error' : ''} ${m.role === 'assistant' && m.text ? 'is-rich' : ''}`}>
              {m.role === 'assistant' && m.text ? <RichText text={m.text} /> : m.text || (m.interrupted ? '(멈췄어요)' : '')}
              {m.error && <div className="bubble-error">문제가 생겼어요: {m.error}</div>}
            </div>
          ))}
          {streaming && (
            <div className="bubble bubble-assistant is-streaming is-rich">
              <RichText text={streaming} />
            </div>
          )}
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
