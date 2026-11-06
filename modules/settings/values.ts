/**
 * 앱 설정값의 검증과 기본값 처리(순수 함수). 앱 상세의 설정 화면, 플랫폼의 스크립트 env, 스케줄 해석이 모두 같은 규칙을 쓴다.
 * 값은 문자열로 보관한다(스크립트에는 env로 간다). 종류별 문자열 모양:
 *   string 그대로 · number 십진수 · boolean 'true'|'false' · choice options 중 하나
 *   time   "HH:MM"(24시간, 두 자리로 맞춘다) · list JSON 문자열 배열(화면에서는 한 줄에 하나로 입력)
 */
import type { SettingDecl } from '../../shared/manifest.ts';

export type ValueResult = { ok: true; value: string } | { ok: false; error: string };

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 화면에서 받은 글을 그 종류의 보관 모양으로. 빈 글은 호출자가 "기본값으로 되돌리기"로 처리한다 */
export const normalizeValue = (d: SettingDecl, raw: string): ValueResult => {
  const v = raw.trim();
  switch (d.type) {
    case 'string':
      return { ok: true, value: raw };
    case 'number': {
      const n = Number(v);
      return v !== '' && Number.isFinite(n) ? { ok: true, value: String(n) } : { ok: false, error: `${d.label}: 숫자로 적어 주세요` };
    }
    case 'boolean':
      return v === 'true' || v === 'false' ? { ok: true, value: v } : { ok: false, error: `${d.label}: 켜기 또는 끄기여야 해요` };
    case 'choice':
      return d.options?.includes(v) ? { ok: true, value: v } : { ok: false, error: `${d.label}: 보기 중에서 골라 주세요` };
    case 'time': {
      const m = TIME_RE.exec(v);
      return m ? { ok: true, value: `${m[1]!.padStart(2, '0')}:${m[2]}` } : { ok: false, error: `${d.label}: 시각은 09:30처럼 적어 주세요(24시간)` };
    }
    case 'list': {
      // JSON 배열이면 그대로, 아니면 줄마다 하나(쉼표도 허용)
      let items: string[];
      if (v.startsWith('[')) {
        try {
          const j = JSON.parse(v) as unknown;
          if (!Array.isArray(j) || !j.every((x) => typeof x === 'string')) throw new Error('not string array');
          items = j as string[];
        } catch {
          return { ok: false, error: `${d.label}: 목록을 읽을 수 없어요` };
        }
      } else {
        items = v.split(/[\n,]/);
      }
      return { ok: true, value: JSON.stringify(items.map((x) => x.trim()).filter(Boolean)) };
    }
  }
};

/** 선언의 기본값을 보관 모양 문자열로. 없으면 undefined */
export const defaultValue = (d: SettingDecl): string | undefined => {
  if (d.default === undefined || d.default === null) return undefined;
  if (typeof d.default === 'string') return d.default;
  return d.type === 'list' && Array.isArray(d.default) ? JSON.stringify(d.default) : JSON.stringify(d.default);
};

/** 저장된 값이 있으면 그것, 없으면 기본값. 둘 다 없으면 undefined(필수 설정이 비어 있는 것) */
export const effectiveValue = (d: SettingDecl, stored: Record<string, string> | undefined): string | undefined => {
  const s = stored?.[d.key];
  return s !== undefined && s !== '' ? s : defaultValue(d);
};

/** 설정 화면이 그리는 칸 하나 */
export interface SettingField {
  key: string;
  label: string;
  type: SettingDecl['type'];
  options: string[];
  required: boolean;
  /** 지금 쓰는 값(저장값 또는 기본값). 없으면 '' */
  value: string;
  /** 기본값. 없으면 null */
  default: string | null;
  /** 사용자가 바꾼 값이 있나(기본값으로 되돌리기를 보일지) */
  changed: boolean;
}

export const toField = (d: SettingDecl, stored: Record<string, string> | undefined): SettingField => ({
  key: d.key,
  label: d.label,
  type: d.type,
  options: d.options ?? [],
  required: d.required === true,
  value: effectiveValue(d, stored) ?? '',
  default: defaultValue(d) ?? null,
  changed: stored?.[d.key] !== undefined && stored[d.key] !== '',
});

/** 매일 "HH:MM"에 도는 cron 5칸. 모양이 틀리면 null */
export const cronAt = (hhmm: string): string | null => {
  const m = TIME_RE.exec(hhmm);
  return m ? `${Number(m[2])} ${Number(m[1])} * * *` : null;
};
