/**
 * 5칸 cron(분 시 일 월 요일) 최소 매처. 지원: `*`, 숫자, `a-b`, `a,b`, `* /n`(스텝). 이름(mon, jan)은 안 받는다.
 * 분 단위로 "지금 이 분이 맞는가"만 본다. 다음 실행 시각 계산은 하지 않는다(실행기가 1분마다 묻는다).
 */
const RANGES: readonly [number, number][] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];

const parseField = (field: string, [lo, hi]: [number, number]): Set<number> | null => {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1) return null;
    const a = m[1] === '*' ? lo : Number(m[2]);
    const b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : a;
    if (a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
};

export type Cron = { fields: Set<number>[] };

export const parseCron = (expr: string): Cron | null => {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields = parts.map((p, i) => parseField(p, RANGES[i]));
  if (fields.some((f) => f === null)) return null;
  const dow = fields[4]!;
  if (dow.has(7)) dow.add(0); // 7도 일요일
  return { fields: fields as Set<number>[] };
};

export const cronMatches = (c: Cron, d: Date): boolean =>
  c.fields[0].has(d.getMinutes()) && c.fields[1].has(d.getHours()) && c.fields[2].has(d.getDate()) && c.fields[3].has(d.getMonth() + 1) && c.fields[4].has(d.getDay());
