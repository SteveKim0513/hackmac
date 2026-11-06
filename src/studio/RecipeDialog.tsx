import { useState } from 'react';
import type { RecipeView } from '../../shared/studio';

type Ok = Extract<RecipeView, { ok: true }>;

interface Props {
  recipe: Ok;
  onClose: () => void;
}

/**
 * 레시피 보내기 전 확인(계획서 12.3). 보내는 사람이 빈칸과 참고 블록을 확인한다 — 참고 블록은 접어서 보여 준다.
 * 글은 직접 고칠 수 있다(복사할 때는 고친 글이 나간다). 코드는 들어 있지 않고, 보낸 사람의 환경 값은 빈칸으로만 나간다.
 */
export function RecipeDialog({ recipe, onClose }: Props) {
  const [text, setText] = useState(recipe.text);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="레시피">
      <div className="modal-card recipe-card" data-recipe-dialog>
        <div className="modal-head">
          <div>
            <h2>레시피</h2>
            <p className="muted">받는 사람이 HackMac의 [앱 만들기]에 붙여넣으면 같은 앱을 자기 환경에 맞게 만들어요. 코드는 들어 있지 않아요.</p>
          </div>
        </div>

        {recipe.warnings.length > 0 && (
          <div className="build-box is-ask" data-recipe-warnings>
            <strong>보내기 전에 확인해 주세요</strong>
            <ul>
              {recipe.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <h3>받는 사람이 채울 빈칸 {recipe.blanks.length}개</h3>
        {recipe.blanks.length > 0 ? (
          <ul className="modal-list" data-recipe-blanks>
            {recipe.blanks.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">채울 빈칸이 없어요.</p>
        )}

        {recipe.references.length > 0 && (
          <details className="build-log" data-recipe-refs>
            <summary>참고한 오픈소스 {recipe.references.length}개</summary>
            <ol>
              {recipe.references.map((r) => (
                <li key={r.text} className="recipe-ref">
                  {r.text}
                </li>
              ))}
            </ol>
          </details>
        )}

        <h3>레시피 글</h3>
        <textarea className="recipe-text" data-recipe-text value={text} onChange={(e) => { setText(e.target.value); setCopied(null); }} spellCheck={false} />

        <div className="modal-actions">
          {copied === 'ok' && <span className="muted recipe-copied">복사했어요</span>}
          {copied === 'fail' && <span className="account-warn">복사하지 못했어요. 글을 선택해서 복사해 주세요</span>}
          <button className="header-button" onClick={onClose}>
            닫기
          </button>
          <button className="toggle-button is-active" data-recipe-copy onClick={() => void copy()}>
            복사
          </button>
        </div>
      </div>
    </div>
  );
}
