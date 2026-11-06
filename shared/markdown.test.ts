import { describe, expect, it } from 'vitest';
import { GLOSSARY } from './glossary';
import { linkTerms, parseInline, parseMarkdown, renderTree, type Block, type Inline } from './markdown';

const flat = (nodes: Inline[]): string =>
  nodes.map((n) => (n.t === 'text' || n.t === 'code' || n.t === 'term' ? n.v : n.t === 'br' ? '\n' : flat(n.c))).join('');

describe('parseInline', () => {
  it('굵게·기울임·코드를 나눈다', () => {
    expect(parseInline('a **b** c *d* `e`')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'b', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' c ' },
      { t: 'i', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' },
      { t: 'code', v: 'e' },
    ]);
  });
  it('닫히지 않은 표시는 글자 그대로 둔다(스트리밍 중 반쯤 온 글)', () => {
    expect(parseInline('**안 닫힘')).toEqual([{ t: 'text', v: '**안 닫힘' }]);
    expect(parseInline('`안 닫힘')).toEqual([{ t: 'text', v: '`안 닫힘' }]);
  });
  it('곱셈표·공백 별표는 기울임이 아니다', () => {
    expect(flat(parseInline('2 * 3 * 4'))).toBe('2 * 3 * 4');
    expect(parseInline('2 * 3 * 4').some((n) => n.t === 'i')).toBe(false);
  });
  it('코드 안의 별표는 서식이 아니다', () => {
    expect(parseInline('`**x**`')).toEqual([{ t: 'code', v: '**x**' }]);
  });
  it('HTML은 해석하지 않고 글자로 둔다', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ t: 'text', v: '<script>alert(1)</script>' }]);
  });
});

describe('parseMarkdown', () => {
  it('사용자가 보여 준 글: 굵은 말머리 문단과 숫자 목록', () => {
    const src = '**상태 표시줄에 주가는 안 돼요.** 대신 있어요.\n\n**→ 대신 되는 것.**\n\n1. **단축키**를 누르면\n2. 고른 주식을 **알림 배너**로\n\n이렇게 만들까요?';
    const b = parseMarkdown(src);
    expect(b.map((x) => x.t)).toEqual(['p', 'p', 'ol', 'p']);
    const ol = b[2] as Extract<Block, { t: 'ol' }>;
    expect(ol.items).toHaveLength(2);
    expect(ol.start).toBe(1);
    expect(ol.items[0]![0]).toEqual({ t: 'b', c: [{ t: 'text', v: '단축키' }] });
    expect(flat((b[0] as Extract<Block, { t: 'p' }>).c)).toBe('상태 표시줄에 주가는 안 돼요. 대신 있어요.');
  });
  it('문단 안의 줄바꿈은 br로 남는다', () => {
    const b = parseMarkdown('첫 줄\n둘째 줄') as Extract<Block, { t: 'p' }>[];
    expect(b).toHaveLength(1);
    expect(b[0]!.c.map((n) => n.t)).toEqual(['text', 'br', 'text']);
  });
  it('- 목록과 # 제목과 코드 블록', () => {
    const b = parseMarkdown('# 제목\n- 하나\n- 둘\n```\n*코드* 안\n```');
    expect(b.map((x) => x.t)).toEqual(['h', 'ul', 'pre']);
    expect((b[2] as Extract<Block, { t: 'pre' }>).v).toBe('*코드* 안');
  });
  it('3. 부터 시작하는 숫자 목록은 번호를 기억한다', () => {
    const b = parseMarkdown('3. 셋\n4. 넷') as Extract<Block, { t: 'ol' }>[];
    expect(b[0]!.start).toBe(3);
  });
  it('닫히지 않은 코드 블록도 끝까지 코드로 읽는다', () => {
    expect(parseMarkdown('```\na\nb').map((x) => x.t)).toEqual(['pre']);
  });
  it('빈 글은 블록이 없다', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });
});

describe('linkTerms / renderTree', () => {
  const terms = (nodes: Inline[]): string[] => nodes.flatMap((n) => (n.t === 'term' ? [n.entry.term] : n.t === 'b' || n.t === 'i' ? terms(n.c) : []));

  it('용어를 표시하고 글자는 그대로 보존한다', () => {
    const out = linkTerms(parseInline('알림 배너로 보여 줘요'), new Set());
    expect(terms(out)).toEqual(['알림 배너']);
    expect(flat(out)).toBe('알림 배너로 보여 줘요');
  });
  it('굵은 글 안의 용어도 표시한다', () => {
    expect(terms(linkTerms(parseInline('**알림 배너**로'), new Set()))).toEqual(['알림 배너']);
  });
  it('같은 용어는 글 전체에서 처음 한 번만', () => {
    const tree = renderTree('단축키를 누르세요.\n\n- 다른 단축키도\n- 단축키 셋');
    const all = tree.flatMap((b) => (b.t === 'p' || b.t === 'h' ? terms(b.c) : b.t === 'ul' || b.t === 'ol' ? b.items.flatMap(terms) : []));
    expect(all).toEqual(['단축키']);
  });
  it('별칭은 대표 항목으로 모이고, 대표와 같은 한 번으로 센다', () => {
    const tree = renderTree('상태 표시줄과 메뉴바') as Extract<Block, { t: 'p' }>[];
    expect(terms(tree[0]!.c)).toEqual(['메뉴바']);
    expect(flat(tree[0]!.c)).toBe('상태 표시줄과 메뉴바');
  });
  it('긴 말이 먼저 맞는다: 손쉬운 사용 권한이 권한보다 먼저', () => {
    const out = linkTerms(parseInline('손쉬운 사용 권한이 필요하고 권한 승인 창이 떠요'), new Set());
    expect(terms(out)).toEqual(['손쉬운 사용 권한', '권한 승인 창']);
  });
  it('코드 안은 건드리지 않는다', () => {
    expect(terms(linkTerms(parseInline('`단축키`'), new Set()))).toEqual([]);
  });
  it('용어집의 모든 설명은 세 문장 안, 대표 이름이 겹치지 않는다', () => {
    const names = GLOSSARY.flatMap((e) => [e.term, ...(e.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
    for (const e of GLOSSARY) expect(e.text.split(/[.!?]\s|[.!?]$/).filter(Boolean).length, e.term).toBeLessThanOrEqual(3);
  });
});
