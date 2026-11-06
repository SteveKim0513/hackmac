/**
 * 가능성 평가(계획서 7.2). 만드는 에이전트가 아닌 별도 역할이 한다 — 만드는 쪽은 "될 것 같다"로 기운다.
 * 판정: 가능 / 조건부 가능 / 불가능. 조건은 개발 전에 사용자가 확인한다.
 * 대화 엔진은 주입받는다(ask). 출력은 JSON 한 덩어리로 강제하고, 못 읽으면 평가 실패로 돌려준다(지어내지 않는다).
 */
import type { Verdict } from './progress.ts';

export interface EvaluateInput {
  requirements: { id: string; text: string }[];
  capabilities: string;
  /** Apple 앱 데이터 접근 사전 진단(docs/apple-app-data-access-guide.md) 요약 */
  appleGuide?: string;
  macosVersion: string;
}

export const evaluatorPrompt = (i: EvaluateInput): string => [
  '너는 HackMac 앱의 가능성 평가 담당이다. 앱을 만들지 않는다. 아래 요구사항을 HackMac 능력 목록만으로 만들 수 있는지 판정한다.',
  '',
  `사용자 macOS: ${i.macosVersion}`,
  '',
  '## 요구사항',
  ...i.requirements.map((r) => `${r.id}. ${r.text}`),
  '',
  '## HackMac 능력 목록',
  i.capabilities,
  ...(i.appleGuide ? ['', '## Apple 앱 데이터 접근 사전 진단', i.appleGuide] : []),
  '',
  '## 판정 기준',
  '- possible: 능력 목록과 macOS 기본 도구만으로 지금 만들 수 있다.',
  '- conditional: 사용자가 무언가를 정하거나 갖춰야 한다(유료 API 키, 계정, 데이터 출처 선택, 권한 승인, 기능 범위 축소 등). conditions에 사용자가 확인할 것을 쉬운 말로 적는다.',
  '- impossible: macOS가 막거나, 필요한 능력이 HackMac에 없거나, 외부 조건으로도 안 된다. reasons에 근거를 적는다.',
  '- 권한 승인 창이 한 번 뜨는 것만으로는 conditional이 아니다(그건 제작 중 사용자 확인 단계에서 처리한다).',
  '- 요구사항 일부만 불가능하면 conditional로 하고, 그 부분을 빼는 것을 조건으로 적는다.',
  '',
  '## 출력',
  '설명 없이 JSON 한 덩어리만 출력한다. 마크다운 코드 블록도 쓰지 않는다. 모양:',
  '{"kind":"possible|conditional|impossible","summary":"한 문장 결론(한국어, 쉬운 말)","conditions":["…"],"reasons":["…"]}',
].join('\n');

/** 엔진 답에서 첫 JSON 객체를 꺼낸다(앞뒤 잡글·코드 블록을 견딘다) */
export const parseVerdict = (text: string, by: string): Verdict | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (o.kind !== 'possible' && o.kind !== 'conditional' && o.kind !== 'impossible') return null;
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, 400)) : []);
    const summary = typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim().slice(0, 300) : '';
    if (!summary) return null;
    return { kind: o.kind, summary, conditions: list(o.conditions), reasons: list(o.reasons), by };
  } catch {
    return null;
  }
};

export const formatVerdict = (v: Verdict): string => {
  const head = { possible: '가능', conditional: '조건부 가능', impossible: '불가능' }[v.kind];
  return [
    `가능성 평가: ${head} (평가: ${v.by})`,
    v.summary,
    ...(v.conditions.length ? ['사용자에게 확인할 조건:', ...v.conditions.map((c) => `  - ${c}`)] : []),
    ...(v.reasons.length ? ['근거:', ...v.reasons.map((r) => `  - ${r}`)] : []),
    v.kind === 'possible' ? '→ 바로 개발(step 3)로 가도 된다.' : v.kind === 'conditional' ? '→ 조건을 사용자에게 쉬운 말로 묻고, 사용자가 받아들이면 요구사항을 고친 뒤 개발한다.' : '→ 만들지 않는다. 결론 한 줄 → 쉬운 이유 → 대신 할 수 있는 것 순서로 사용자에게 알리고 fail로 기록한다.',
  ].join('\n');
};

export async function evaluate(input: EvaluateInput, ask: (prompt: string) => Promise<string>, by: string): Promise<{ ok: true; verdict: Verdict } | { ok: false; error: string }> {
  if (input.requirements.length === 0) return { ok: false, error: '요구사항이 없음 — 먼저 req로 요구사항을 기록한다' };
  let text: string;
  try {
    text = await ask(evaluatorPrompt(input));
  } catch (err) {
    return { ok: false, error: `평가 엔진이 답하지 못함: ${(err as Error).message}` };
  }
  const v = parseVerdict(text, by);
  return v ? { ok: true, verdict: v } : { ok: false, error: `평가 결과를 읽지 못함: ${text.slice(0, 200)}` };
}
