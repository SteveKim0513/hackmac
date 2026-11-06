/**
 * 배운 것 쌓기. 대화와 스레드 기억(modules/memory)은 앱 하나에 묶여 있지만, 여기는 앱을 넘어 다음 제작이 이어받을 것을 둔다:
 *   pitfall     제작 중 검증·감사에서 걸렸다가 고친 것, 끝내 막힌 방법(같은 실수를 반복하지 않게)
 *   preference  사용자가 말한 일반적인 취향(예: "회의 중엔 창보다 배너가 좋다") — 요구 정리 담당이 `learn`으로 남긴다
 * 모든 전문 담당의 프롬프트와 요구 정리 담당의 지시에 최근 것부터 몇 개가 붙는다. 파일 하나(JSONL), 추가만 하고 같은 글은 다시 넣지 않는다.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

export type LessonKind = 'pitfall' | 'preference';
export interface Lesson { id: string; kind: LessonKind; text: string; source: string; at: string }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export class KnowledgeStore {
  constructor(private readonly file: string, private readonly now: () => Date = () => new Date()) {
    mkdirSync(dirname(file), { recursive: true });
  }

  list(): Lesson[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8').split('\n').flatMap((l) => {
      if (!l.trim()) return [];
      try {
        const x = JSON.parse(l) as Lesson;
        return x && typeof x.text === 'string' && (x.kind === 'pitfall' || x.kind === 'preference') ? [x] : [];
      } catch {
        return [];
      }
    });
  }

  /** 같은 글(띄어쓰기·대소문자 무시)이 이미 있으면 넣지 않는다 */
  add(kind: LessonKind, text: string, source: string): Lesson | null {
    const t = text.replace(/\s+/g, ' ').trim().slice(0, 400);
    if (t.length < 8) return null;
    if (this.list().some((x) => norm(x.text) === norm(t))) return null;
    const lesson: Lesson = { id: randomUUID(), kind, text: t, source, at: this.now().toISOString() };
    appendFileSync(this.file, JSON.stringify(lesson) + '\n');
    return lesson;
  }

  /** 프롬프트에 붙일 것: 최근 것부터 n개, 글만 */
  recent(n = 12, kind?: LessonKind): string[] {
    return this.list().filter((x) => !kind || x.kind === kind).slice(-n).reverse().map((x) => (x.kind === 'preference' ? `(사용자 취향) ${x.text}` : x.text));
  }
}
