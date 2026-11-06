/**
 * 목표 달성 감사. 설치 직전에 "기획에서 확정한 요구사항이 정말 구현됐는지"와 "서비스 기준(docs/service-baseline.md)을 지켰는지"를
 * 앱 파일에 대어 항목마다 충족·미충족과 근거로 낸다. 감사는 만든 쪽과 다른 회사 엔진이 하고 코드를 고치지 않는다.
 * 하나라도 미충족이거나 판정을 못 읽으면 설치하지 않는다(통과로 치지 않는다). 코드가 직접 볼 수 있는 기준(설정 선언↔사용, 오류 시험, 기록 줄)은
 * 검증 게이트(gate.ts)가 이미 봤다 — 여기는 읽고 판단해야 하는 것만 본다.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface AuditItem {
  id: string;
  kind: 'goal' | 'baseline';
  label: string;
  met: boolean;
  evidence: string;
  gap: string;
}
export interface AuditResult { ok: boolean; by: string; items: AuditItem[] }

/** 감사가 보는 서비스 기준(문서의 S1은 요구사항 항목이 대신하고, S7·S9·S10은 게이트·요구사항이 본다) */
export const BASELINE_AUDIT: { id: string; label: string; text: string }[] = [
  { id: 'S2', label: '조정 가능', text: '사람마다 다를 수 있는 값(시각·횟수·이름·주소·분량·켜기 끄기)이 코드에 박혀 있지 않고 settings로 선언돼 있으며 스크립트가 그 값을 읽는다. 기본값은 바로 써도 되는 값이다.' },
  { id: 'S3', label: '첫 사용 준비', text: '필수 설정이 비어 있거나 권한이 없을 때 조용히 실패하지 않고 "설정에서 ○○을 정해 주세요" 같은 안내가 사용자에게 보인다. 필요한 권한 승인 창이 뜬다는 것을 usage가 안내한다.' },
  { id: 'S4', label: '결과가 보인다', text: '실행할 때마다 사용자가 결과를 본다: 잘 됐을 때, 할 일이 없을 때(빈 결과), 안 됐을 때 모두. 아무 일도 안 일어난 것처럼 끝나는 경로가 없다.' },
  { id: 'S5', label: '실패를 안다', text: '외부 호출(인터넷·다른 앱 자동화)이 실패하거나 빈 결과일 때 이유를 쉬운 말로 사용자에게 알리고 로그에 남긴다.' },
  { id: 'S6', label: '다시 해도 안전', text: '같은 실행을 두 번 해도·중간에 끊겨도 데이터가 꼬이거나 사라지지 않는다. 되돌릴 수 없는 일은 먼저 확인을 받는다. 파일은 $HACKMAC_DATA_DIR 안에만 쓴다.' },
  { id: 'S8', label: '설명이 있다', text: 'tagline·usage가 쉬운 말로 쓰였고, 설정이 있는 앱이면 "앱 상세의 설정에서 바꿀 수 있다"는 안내가 usage에 있다.' },
];

const MAX_TOTAL = 80_000;
const MAX_FILE = 14_000;

/** 감사에 보여 줄 파일: 선언 → 스크립트 → 시험 순. 너무 길면 뒤를 자른다 */
export const collectFiles = (pkgDir: string): { files: { path: string; text: string }[]; truncated: boolean } => {
  const all: string[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) walk(p);
      else all.push(relative(pkgDir, p));
    }
  };
  if (existsSync(pkgDir)) walk(pkgDir);
  const rank = (f: string) => (f === 'manifest.json' ? 0 : f.startsWith('scripts/') ? 1 : f.startsWith('checks/') ? 2 : 3);
  all.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const files: { path: string; text: string }[] = [];
  let total = 0;
  let truncated = false;
  for (const f of all) {
    if (rank(f) === 3) continue;
    let text: string;
    try {
      if (lstatSync(join(pkgDir, f)).size > 1_000_000) continue;
      text = readFileSync(join(pkgDir, f), 'utf8');
    } catch {
      continue;
    }
    if (text.length > MAX_FILE) { text = `${text.slice(0, MAX_FILE)}\n… (이하 생략)`; truncated = true; }
    if (total + text.length > MAX_TOTAL) { truncated = true; break; }
    files.push({ path: f, text });
    total += text.length;
  }
  return { files, truncated };
};

const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * 엔진 답에서 판정을 읽는다. 요구사항·기준의 모든 항목이 있어야 한다 — 빠진 항목은 미충족으로 친다("판정하지 않음"을 통과로 두지 않는다).
 * JSON을 못 읽으면 null.
 */
export const parseAudit = (text: string, requirements: { id: string; text: string }[], by: string): AuditResult | null => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);
  const goals = rows(o.goals);
  const base = rows(o.baseline);
  if (goals.length === 0 && base.length === 0) return null;
  const find = (list: Record<string, unknown>[], id: string) => list.find((r) => str(r.id, 8) === id);
  const items: AuditItem[] = [
    ...requirements.map((r): AuditItem => {
      const row = find(goals, r.id);
      return { id: r.id, kind: 'goal', label: r.text, met: row?.met === true, evidence: str(row?.evidence), gap: row ? str(row.gap) : '감사가 이 항목을 판정하지 않았음' };
    }),
    ...BASELINE_AUDIT.map((b): AuditItem => {
      const row = find(base, b.id);
      return { id: b.id, kind: 'baseline', label: b.label, met: row?.met === true, evidence: str(row?.evidence), gap: row ? str(row.gap) : '감사가 이 항목을 판정하지 않았음' };
    }),
  ];
  // 충족인데 근거가 없으면 믿지 않는다
  for (const it of items) if (it.met && !it.evidence) { it.met = false; it.gap = '충족이라 했지만 코드에서 찾은 근거가 없음'; }
  return { ok: items.every((x) => x.met), by, items };
};

export const formatAudit = (r: AuditResult): string => {
  const lines = [r.ok ? '목표 확인 통과' : '목표 확인 실패'];
  for (const it of r.items) {
    lines.push(`${it.met ? '✓' : '✗'} ${it.id} ${it.label}${it.met ? '' : ` — ${it.gap || '근거 없음'}`}`);
  }
  return lines.join('\n');
};
