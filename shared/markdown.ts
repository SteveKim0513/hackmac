/**
 * 채팅 글을 화면에 그리기 위한 아주 작은 마크다운 해석기. HTML을 만들지 않고 트리만 돌려준다 —
 * 그리는 쪽(src/components/RichText.tsx)이 React 요소로 바꾸므로 글 안의 어떤 문자열도 코드로 실행되지 않는다.
 * 지원: **굵게**, *기울임*, `코드`, 코드 블록, # 제목, 숫자·점 목록, 문단(줄바꿈은 그대로 둔다).
 * 링크·이미지·표·HTML은 해석하지 않고 글자 그대로 보인다(에이전트 글에서 필요한 것만).
 */
import { GLOSSARY, type GlossaryEntry } from './glossary';

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'b'; c: Inline[] }
  | { t: 'i'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'term'; v: string; entry: GlossaryEntry };

export type Block =
  | { t: 'p'; c: Inline[] }
  | { t: 'h'; c: Inline[] }
  | { t: 'ul'; items: Inline[][] }
  | { t: 'ol'; start: number; items: Inline[][] }
  | { t: 'pre'; v: string };

/** 한 줄 안의 서식. 굵게·기울임은 안에 `코드`를 품을 수 있고, 닫히지 않은 표시는 글자 그대로 둔다(스트리밍 중 반쯤 온 글) */
export const parseInline = (src: string): Inline[] => {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ t: 'text', v: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith('`')) {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith('**')) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'b', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    // 기울임: *뒤에 공백이 없고 닫는 *가 있을 때만(곱셈표·목록 기호와 구분)
    if (rest.startsWith('*') && !rest.startsWith('**') && rest[1] !== undefined && !/\s/.test(rest[1])) {
      const end = src.indexOf('*', i + 1);
      if (end > i + 1 && !/\s/.test(src[end - 1]!) && src[end + 1] !== '*') {
        flush();
        out.push({ t: 'i', c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buf += src[i];
    i++;
  }
  flush();
  return out;
};

/** 문단 안의 줄바꿈은 <br>로 남긴다(채팅이라 줄 하나하나가 뜻이 있다) */
const inlineLines = (lines: string[]): Inline[] =>
  lines.flatMap((l, k) => (k === 0 ? parseInline(l) : [{ t: 'br' } as Inline, ...parseInline(l)]));

const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*(\d+)[.)]\s+(.*)$/;
const H = /^\s{0,3}#{1,4}\s+(.*)$/;

export const parseMarkdown = (src: string): Block[] => {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ t: 'p', c: inlineLines(para) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i++]!);
      blocks.push({ t: 'pre', v: body.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    const h = H.exec(line);
    if (h) {
      flushPara();
      blocks.push({ t: 'h', c: parseInline(h[1]!.trim()) });
      continue;
    }
    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      const start = ol ? Number(ol[1]) : 1;
      const items: Inline[][] = [];
      let j = i;
      while (j < lines.length) {
        const m = (ordered ? OL : UL).exec(lines[j]!);
        if (!m) break;
        items.push(parseInline((ordered ? m[2] : m[1])!));
        j++;
      }
      blocks.push(ordered ? { t: 'ol', start, items } : { t: 'ul', items });
      i = j - 1;
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
};

/** 긴 단어가 먼저 맞도록 정렬한 (표기 → 항목) 목록. "손쉬운 사용 권한"이 "권한"보다 먼저 잡힌다 */
const buildIndex = (entries: GlossaryEntry[]) =>
  entries
    .flatMap((e) => [e.term, ...(e.aliases ?? [])].map((name) => ({ name, entry: e })))
    .sort((a, b) => b.name.length - a.name.length);

/**
 * 글 안의 용어집 단어를 { t: 'term' }으로 바꾼다. 같은 항목은 글 하나에서 처음 한 번만 표시한다 —
 * 모든 곳에 밑줄이 있으면 읽기 어렵고, 처음에 한 번 풀어 주면 충분하다. `코드` 안은 건드리지 않는다.
 * seen을 블록들 사이에 이어서 넘겨야 글 전체에서 한 번이 된다.
 */
export const linkTerms = (nodes: Inline[], seen: Set<string>, entries: GlossaryEntry[] = GLOSSARY): Inline[] => {
  const index = buildIndex(entries);
  const walk = (list: Inline[]): Inline[] =>
    list.flatMap((n): Inline[] => {
      if (n.t === 'b' || n.t === 'i') return [{ ...n, c: walk(n.c) }];
      if (n.t !== 'text') return [n];
      const out: Inline[] = [];
      let text = n.v;
      for (;;) {
        let best: { at: number; name: string; entry: GlossaryEntry } | null = null;
        for (const { name, entry } of index) {
          if (seen.has(entry.term)) continue;
          const at = text.indexOf(name);
          if (at < 0) continue;
          // 가장 앞에서 시작하는 것, 같은 자리면 더 긴 것(index가 긴 순이라 먼저 본 것이 이긴다)
          if (!best || at < best.at) best = { at, name, entry };
        }
        if (!best) break;
        if (best.at > 0) out.push({ t: 'text', v: text.slice(0, best.at) });
        out.push({ t: 'term', v: best.name, entry: best.entry });
        seen.add(best.entry.term);
        text = text.slice(best.at + best.name.length);
      }
      if (text) out.push({ t: 'text', v: text });
      return out;
    });
  return walk(nodes);
};

/** 글 전체: 해석하고 용어를 표시한다 */
export const renderTree = (src: string, entries: GlossaryEntry[] = GLOSSARY): Block[] => {
  const seen = new Set<string>();
  const link = (c: Inline[]) => linkTerms(c, seen, entries);
  return parseMarkdown(src).map((b): Block => {
    if (b.t === 'p' || b.t === 'h') return { ...b, c: link(b.c) };
    if (b.t === 'ul') return { ...b, items: b.items.map(link) };
    if (b.t === 'ol') return { ...b, items: b.items.map(link) };
    return b;
  });
};
