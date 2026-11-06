/**
 * 채점표: 일하기 전에 "무엇이 되면 합격인가"를 먼저 글로 고정한다. 만든 쪽과 다른 역할(채점 담당)이 쓰고,
 * 시험 담당은 auto 기준을 시험으로, 감사 담당은 전체를 채점한다. 사용자도 이 표만 보고 결과를 판정할 수 있다.
 * 읽기 규칙은 엄격하다: 요구사항마다 기준이 하나 이상 있어야 하고, 모르는 요구사항을 가리키는 기준은 버린다.
 */
import type { RubricItem } from './progress.ts';

export const parseRubric = (text: string, reqIds: string[]): { ok: true; items: RubricItem[] } | { ok: false; error: string } => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, error: '채점표 JSON이 없음' };
  let o: unknown;
  try {
    o = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: '채점표 JSON을 읽을 수 없음' };
  }
  const raw = (o as { items?: unknown }).items;
  if (!Array.isArray(raw)) return { ok: false, error: '채점표에 items가 없음' };
  const known = new Set(reqIds);
  const seen = new Set<string>();
  const items: RubricItem[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const x = r as Record<string, unknown>;
    const req = typeof x.req === 'string' ? x.req.trim() : '';
    const criterion = typeof x.criterion === 'string' ? x.criterion.trim().slice(0, 300) : '';
    if (!known.has(req) || !criterion) continue;
    let id = typeof x.id === 'string' && /^R\d+\.\d+$/.test(x.id.trim()) ? x.id.trim() : '';
    if (!id || seen.has(id) || !id.startsWith(`${req}.`)) {
      // 번호가 틀리거나 겹치면 그 요구사항의 다음 번호를 준다
      let n = 1;
      while (seen.has(`${req}.${n}`)) n++;
      id = `${req}.${n}`;
    }
    seen.add(id);
    items.push({ id, req, criterion, how: x.how === 'manual' ? 'manual' : 'auto' });
    if (items.length >= 40) break;
  }
  const missing = reqIds.filter((id) => !items.some((x) => x.req === id));
  if (missing.length) return { ok: false, error: `기준이 없는 요구사항: ${missing.join(', ')}` };
  items.sort((a, b) => Number(a.req.slice(1)) - Number(b.req.slice(1)) || Number(a.id.split('.')[1]) - Number(b.id.split('.')[1]));
  return { ok: true, items };
};
