import { useCallback, useEffect, useState } from 'react';
import type { AppSettingsView, SettingField } from '../../shared/studio';

type Ok = Extract<AppSettingsView, { ok: true }>;

/** list 값(JSON 배열 문자열)을 입력칸의 "한 줄에 하나"로 */
const listToText = (v: string): string => {
  try {
    const j = JSON.parse(v) as unknown;
    return Array.isArray(j) ? j.join('\n') : v;
  } catch {
    return v;
  }
};

/** 보관된 값을 입력칸에 보이는 모양으로(목록은 줄마다) */
const display = (f: SettingField, v: string): string => (f.type === 'list' ? listToText(v) : v);

/**
 * 앱의 설정 화면. 선언한 settings·secrets가 그대로 입력칸이 된다 — 값은 바꾸는 즉시 저장되고(검증은 HackMac 쪽),
 * 상주·스케줄이 있는 앱은 새 값으로 다시 붙는다. 비밀값은 저장만 되고 화면에 다시 보이지 않는다.
 */
export function AppSettings({ appId }: { appId: string }) {
  const [view, setView] = useState<AppSettingsView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ key: string; text: string; error: boolean } | null>(null);

  const load = useCallback(async () => {
    const v = await window.playbook.appSettings(appId);
    setView(v);
    if (v.ok) setDrafts(Object.fromEntries(v.fields.map((f) => [f.key, display(f, f.value)])));
  }, [appId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return null;
  if (!view.ok) return null;
  const ok: Ok = view;

  const apply = (r: { ok: true; view: AppSettingsView } | { ok: false; error: string }, key: string) => {
    if (r.ok) {
      setView(r.view);
      if (r.view.ok) setDrafts(Object.fromEntries(r.view.fields.map((f) => [f.key, display(f, f.value)])));
      setMsg({ key, text: '저장했어요', error: false });
      window.setTimeout(() => setMsg((m) => (m?.key === key ? null : m)), 2000);
    } else {
      setMsg({ key, text: r.error, error: true });
      void load(); // 입력칸을 저장된 값으로 되돌린다
    }
  };

  const save = async (f: SettingField, text: string) => {
    if (text === display(f, f.value)) return; // 바뀐 게 없다
    apply(await window.playbook.setAppSetting(appId, f.key, text), f.key);
  };

  const input = (f: SettingField) => {
    const v = drafts[f.key] ?? '';
    const set = (x: string) => setDrafts((d) => ({ ...d, [f.key]: x }));
    switch (f.type) {
      case 'boolean':
        return (
          <label className="setting-switch">
            <input type="checkbox" data-setting-input={f.key} checked={f.value === 'true'} onChange={(e) => void apply0(f, String(e.target.checked))} />
            <span>{f.value === 'true' ? '켜짐' : '꺼짐'}</span>
          </label>
        );
      case 'choice':
        return (
          <select data-setting-input={f.key} value={v} onChange={(e) => void apply0(f, e.target.value)}>
            {!f.options.includes(v) && <option value="">고르세요</option>}
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        );
      case 'time':
        return <input type="time" data-setting-input={f.key} value={v} onChange={(e) => set(e.target.value)} onBlur={() => void save(f, v)} />;
      case 'number':
        return <input type="number" data-setting-input={f.key} value={v} onChange={(e) => set(e.target.value)} onBlur={() => void save(f, v)} onKeyDown={(e) => e.key === 'Enter' && void save(f, v)} />;
      case 'list':
        return <textarea data-setting-input={f.key} rows={3} value={v} placeholder="한 줄에 하나씩" onChange={(e) => set(e.target.value)} onBlur={() => void save(f, v)} />;
      default:
        return <input type="text" data-setting-input={f.key} value={v} onChange={(e) => set(e.target.value)} onBlur={() => void save(f, v)} onKeyDown={(e) => e.key === 'Enter' && void save(f, v)} />;
    }
  };

  // 선택·스위치는 바로 저장한다
  const apply0 = async (f: SettingField, text: string) => {
    setDrafts((d) => ({ ...d, [f.key]: text }));
    apply(await window.playbook.setAppSetting(appId, f.key, text), f.key);
  };

  const hasAny = ok.fields.length > 0 || ok.secrets.length > 0;

  return (
    <section className="detail-section app-settings" data-app-settings>
      <h2>설정</h2>
      {!hasAny && <p className="muted">이 앱은 따로 조정할 설정이 없어요.</p>}
      {ok.missing.length > 0 && (
        <div className="build-box is-ask" data-settings-missing>
          <strong>켜기 전에 정해 주세요</strong>
          <p>{ok.missing.join(', ')}</p>
        </div>
      )}
      {ok.fields.map((f) => (
        <div key={f.key} className="setting-row" data-setting={f.key}>
          <div className="setting-label">
            <label>
              {f.label}
              {f.required && <span className="setting-required"> 필수</span>}
            </label>
            {f.changed && f.default !== null && (
              <button type="button" className="setting-reset" onClick={() => void apply0(f, '')}>
                기본값({display(f, f.default).replace(/\n/g, ', ')})으로 되돌리기
              </button>
            )}
          </div>
          <div className="setting-control">
            {input(f)}
            {msg?.key === f.key && <span className={`setting-msg ${msg.error ? 'is-error' : ''}`}>{msg.text}</span>}
          </div>
        </div>
      ))}
      {ok.secrets.map((s) => (
        <div key={s.key} className="setting-row" data-secret={s.key}>
          <div className="setting-label">
            <label>
              {s.label}
              {s.required && <span className="setting-required"> 필수</span>}
            </label>
            <span className="muted">안전하게 보관돼요. 입력한 뒤에는 다시 보이지 않아요.</span>
          </div>
          <div className="setting-control">
            <input
              type="password"
              data-secret-input={s.key}
              autoComplete="off"
              placeholder={s.isSet ? '입력됨 (새로 입력하면 바뀌어요)' : '입력해 주세요'}
              value={secretDrafts[s.key] ?? ''}
              onChange={(e) => setSecretDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
            />
            <button
              type="button"
              className="header-button"
              data-secret-save={s.key}
              disabled={!(secretDrafts[s.key] ?? '')}
              onClick={async () => {
                const r = await window.playbook.setAppSecret(appId, s.key, secretDrafts[s.key] ?? '');
                setSecretDrafts((d) => ({ ...d, [s.key]: '' }));
                apply(r, s.key);
              }}
            >
              저장
            </button>
            {s.isSet && (
              <button type="button" className="header-button" data-secret-clear={s.key} onClick={async () => apply(await window.playbook.setAppSecret(appId, s.key, null), s.key)}>
                지우기
              </button>
            )}
            {msg?.key === s.key && <span className={`setting-msg ${msg.error ? 'is-error' : ''}`}>{msg.text}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}
