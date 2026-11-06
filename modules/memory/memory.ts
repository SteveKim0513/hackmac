/**
 * 앱 기억(계획서 12.2). 대화가 길어지면 컨텍스트가 무거워지고, 계정·회사를 바꾸면 세션을 이어 열 수 없다.
 * 그래서 대화가 끝나면 엔진에게 구조화된 출력을 강제해 "앱 기억 파일" 하나로 압축해 둔다.
 *   - 원문 대화(messages.jsonl)는 지우지 않는다. 기억은 그 위에 얹은 요약이다.
 *   - 다음에 스레드를 열 때 기억이 최신이면 --resume 대신 새 세션에 기억과 최근 몇 턴만 넣는다.
 *   - 레시피(modules/recipe)가 이 파일에서 뽑는다. 그래서 사용자 고유 값(캘린더 이름 등)은 요구사항이 아니라
 *     environment에, "받는 사람이 채워야 할 빈칸 이름(blank)"과 함께 담는다.
 * 파일: <스레드 폴더>/memory.json(안전 쓰기). 엔진 답은 신뢰 경계 밖이라 모든 칸을 따져 읽고 모르는 칸은 버린다.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Message } from '../thread/thread.ts';

export interface MemoryRequirement { id: string; text: string; status: string }
export interface MemoryDecision { what: string; why: string }
/** fact: 보낸 사람의 실제 값이 든 사실(레시피에 안 나간다). blank: 받는 사람이 채울 빈칸의 이름(레시피에 나간다) */
export interface MemoryEnvFact { fact: string; blank: string; sensitive: boolean }
export interface MemoryTried { method: string; whyDropped: string }
export interface MemoryReference { repo: string; commit: string; path: string; borrowed: string; why: string; license: string }

export interface AppMemory {
  schema: 1;
  updatedAt: string;
  /** 이 기억이 어디까지의 대화를 반영하나. 대화가 더 쌓이면 낡은 기억이 된다 */
  basedOn: { messages: number; lastAt: string | null };
  /** 한 줄 목표 */
  goal: string;
  requirements: MemoryRequirement[];
  decisions: MemoryDecision[];
  environment: MemoryEnvFact[];
  tried: MemoryTried[];
  references: MemoryReference[];
  todo: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 400): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = <T>(v: unknown, f: (x: unknown) => T | null, max = 40): T[] => (Array.isArray(v) ? v.slice(0, max).flatMap((x) => { const r = f(x); return r === null ? [] : [r]; }) : []);

/** 기억에 반영되는 글: 사용자·도우미 대화만(알림 글은 뺀다) */
export const countable = (messages: Message[]): Message[] => messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim() !== '');

export const basedOnOf = (messages: Message[]): AppMemory['basedOn'] => {
  const c = countable(messages);
  return { messages: c.length, lastAt: c.at(-1)?.at ?? null };
};

/** 엔진이 낸 JSON(또는 그 안의 객체)을 따져 읽는다. 목표가 비었으면 null — 쓸 수 없는 기억이다 */
export const normalizeMemory = (raw: unknown, basedOn: AppMemory['basedOn'], now: Date): AppMemory | null => {
  if (!isObj(raw)) return null;
  const goal = str(raw.goal, 200);
  if (!goal) return null;
  return {
    schema: 1,
    updatedAt: now.toISOString(),
    basedOn,
    goal,
    requirements: list(raw.requirements, (x) => (isObj(x) && str(x.text) ? { id: str(x.id, 6) || '', text: str(x.text), status: str(x.status, 20) || 'todo' } : null)),
    decisions: list(raw.decisions, (x) => (isObj(x) && str(x.what) ? { what: str(x.what), why: str(x.why) } : null)),
    environment: list(raw.environment, (x) => (isObj(x) && str(x.fact) ? { fact: str(x.fact), blank: str(x.blank, 60), sensitive: x.sensitive === true } : null)),
    tried: list(raw.tried, (x) => (isObj(x) && str(x.method) ? { method: str(x.method), whyDropped: str(x.whyDropped) } : null)),
    references: list(raw.references, (x) => (isObj(x) && str(x.repo, 200) ? { repo: str(x.repo, 200), commit: str(x.commit, 64), path: str(x.path, 200), borrowed: str(x.borrowed), why: str(x.why), license: str(x.license, 60) } : null), 12),
    todo: list(raw.todo, (x) => (str(x) ? str(x) : null), 20),
  };
};

/** 엔진 답 글에서 첫 JSON 객체를 꺼낸다(앞뒤 잡글·코드 블록을 견딘다) */
export const extractJson = (text: string): unknown => {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
};

export class MemoryStore {
  /** dirOf: 스레드 id → 스레드 폴더(ThreadStore.dirOf) */
  constructor(private readonly dirOf: (threadId: string) => string) {}

  private file(id: string): string {
    return join(this.dirOf(id), 'memory.json');
  }

  read(threadId: string): AppMemory | null {
    try {
      const raw = JSON.parse(readFileSync(this.file(threadId), 'utf8')) as unknown;
      return normalizeMemory(raw, isObj(raw) && isObj(raw.basedOn) ? { messages: Number(raw.basedOn.messages) || 0, lastAt: typeof raw.basedOn.lastAt === 'string' ? raw.basedOn.lastAt : null } : { messages: 0, lastAt: null }, new Date(isObj(raw) && typeof raw.updatedAt === 'string' ? raw.updatedAt : 0));
    } catch {
      return null;
    }
  }

  write(threadId: string, m: AppMemory): void {
    const f = this.file(threadId);
    writeFileSync(`${f}.tmp`, JSON.stringify(m, null, 2));
    renameSync(`${f}.tmp`, f);
  }

  exists(threadId: string): boolean {
    return existsSync(this.file(threadId));
  }
}

/** 기억이 지금 대화를 다 반영하나(그렇지 않으면 새 글이 더 있는 낡은 기억) */
export const isCurrent = (m: AppMemory | null, messages: Message[]): m is AppMemory => {
  if (!m) return false;
  const b = basedOnOf(messages);
  return m.basedOn.messages === b.messages && m.basedOn.lastAt === b.lastAt;
};

const STATUS: Record<string, string> = { passed: '시험 통과', failed: '시험 실패', manual: '직접 확인', missing: '시험 없음', todo: '대기' };

/** 새 세션에 넣을 글(계획서 12.2): 기억 + 최근 몇 턴. 지시문 뒤에 붙는다 */
export const renderForSession = (m: AppMemory, messages: Message[], recentTurns = 6): string => {
  const out: string[] = ['## 이 앱의 기억', '이전 대화를 압축한 것이다. 사용자는 이미 말한 것을 다시 묻는 걸 싫어한다. 아래에 있는 것은 다시 묻지 않는다.', '', `목표: ${m.goal}`];
  if (m.requirements.length) out.push('', '요구사항(현재 상태):', ...m.requirements.map((r) => `- ${r.id ? `${r.id} ` : ''}${r.text} [${STATUS[r.status] ?? r.status}]`));
  if (m.decisions.length) out.push('', '결정과 이유:', ...m.decisions.map((d) => `- ${d.what}${d.why ? ` — ${d.why}` : ''}`));
  if (m.environment.length) out.push('', '사용자 환경 사실:', ...m.environment.map((e) => `- ${e.fact}`));
  if (m.tried.length) out.push('', '시도했다 버린 방법(다시 시도하지 않는다):', ...m.tried.map((t) => `- ${t.method}${t.whyDropped ? ` — ${t.whyDropped}` : ''}`));
  if (m.references.length) out.push('', '참고한 것:', ...m.references.map((r) => `- ${r.repo}${r.commit ? ` @ ${r.commit}` : ''}${r.borrowed ? ` — ${r.borrowed}` : ''}`));
  if (m.todo.length) out.push('', '남은 숙제:', ...m.todo.map((t) => `- ${t}`));
  const recent = countable(messages).slice(-recentTurns);
  if (recent.length) out.push('', '## 마지막 대화(원문)', ...recent.map((x) => `${x.role === 'user' ? '사용자' : '도우미'}: ${x.text.slice(0, 1200)}`));
  return out.join('\n');
};

export interface CompressInput {
  messages: Message[];
  previous: AppMemory | null;
  /** 진행 기록이 아는 요구사항(코드가 아는 사실이라 엔진이 지어내지 않게 준다) */
  requirements: MemoryRequirement[];
  /** 앱 선언의 참고(repo·commit·path·borrowed·license) */
  manifestReferences: Omit<MemoryReference, 'why'>[];
}

const MAX_TRANSCRIPT = 36_000;

export const transcriptOf = (messages: Message[]): string => {
  const lines = countable(messages).map((m) => `${m.role === 'user' ? '사용자' : '도우미'}: ${m.text.slice(0, 1500)}`);
  let text = lines.join('\n\n');
  if (text.length > MAX_TRANSCRIPT) {
    // 처음(무엇을 하려던 대화인지)과 끝(지금 상태)을 남기고 가운데를 줄인다
    const head = lines.slice(0, 4).join('\n\n');
    let tail = '';
    for (let i = lines.length - 1; i >= 4 && tail.length < MAX_TRANSCRIPT - head.length - 200; i--) tail = `${lines[i]}\n\n${tail}`;
    text = `${head}\n\n(… 가운데 대화는 길어서 줄였다 …)\n\n${tail}`;
  }
  return text;
};

export const memoryPrompt = (i: CompressInput): string => [
  '너는 HackMac의 기억 정리 담당이다. 앱을 만드는 대화를 읽고, 다음에 이어 하거나 다른 사람이 같은 앱을 만들 수 있게 구조화된 기억으로 압축한다. 앱을 만들지 않고 도구도 쓰지 않는다.',
  '',
  '## 규칙',
  '- 대화에 실제로 나온 것만 적는다. 지어내지 않는다. 모르면 빈 목록.',
  '- requirements는 요구사항을 **일반적인 문장**으로 적는다. 사용자 개인 값(내 캘린더 이름, 종목 코드, 이메일, 파일 경로, 회사 이름)은 요구사항에 쓰지 말고 environment로 뺀다. 예: 요구사항은 "지정한 캘린더의 오늘 일정을 알림으로 보여 준다", 개인 값은 environment.',
  '- environment: 사용자 환경의 사실. fact에는 실제 값이 든 사실("회사 캘린더 이름은 Work"), blank에는 **같은 앱을 만들 다른 사람이 채워야 할 빈칸의 이름**만("캘린더 이름" — 값이 들어가지 않는다). 비밀값(API 키·암호·토큰)이 대화에 나왔더라도 fact에 적지 말고 sensitive를 true로 하고 fact는 "API 키를 쓴다"처럼 값 없이 적는다.',
  '- decisions: 정한 것과 이유("15분 지연 시세로 한다 — 실시간은 유료 키가 필요해서").',
  '- tried: 시도했다 버린 방법과 버린 이유. 다시 시도하지 않게 하려는 것이다.',
  '- references: 대화에서 참고한 오픈소스(저장소 주소, 커밋, 파일·함수, 빌린 것, 고른 이유, 라이선스). 없으면 빈 목록.',
  '- todo: 남은 숙제(아직 안 된 것, 사용자가 해 보기로 한 것).',
  '- goal: 이 앱이 하는 일을 한 줄로(개인 값 없이).',
  '- 한국어, 쉬운 말.',
  '',
  ...(i.requirements.length ? ['## 진행 기록이 아는 요구사항(그대로 쓴다. 상태는 코드가 채운다)', ...i.requirements.map((r) => `${r.id}. ${r.text}`), ''] : []),
  ...(i.manifestReferences.length ? ['## 앱 선언에 적힌 참고(이미 있다. why만 대화에서 찾아 채운다)', ...i.manifestReferences.map((r) => `- ${r.repo} @ ${r.commit}${r.path ? ` ${r.path}` : ''} — ${r.borrowed} (${r.license})`), ''] : []),
  ...(i.previous ? ['## 이전 기억(이어서 고쳐 쓴다. 그 뒤의 대화로 바뀐 것을 반영한다)', JSON.stringify({ goal: i.previous.goal, requirements: i.previous.requirements, decisions: i.previous.decisions, environment: i.previous.environment, tried: i.previous.tried, references: i.previous.references, todo: i.previous.todo }), ''] : []),
  '## 대화',
  transcriptOf(i.messages),
  '',
  '## 출력',
  '설명 없이 JSON 한 덩어리만 출력한다. 마크다운 코드 블록도 쓰지 않는다. 모양:',
  '{"goal":"…","requirements":[{"id":"R1","text":"…"}],"decisions":[{"what":"…","why":"…"}],"environment":[{"fact":"…","blank":"…","sensitive":false}],"tried":[{"method":"…","whyDropped":"…"}],"references":[{"repo":"github.com/x/y","commit":"abc123","path":"src/a.ts#fn","borrowed":"…","why":"…","license":"MIT"}],"todo":["…"]}',
].join('\n');

export interface CompressDeps {
  ask: (prompt: string) => Promise<string>;
  now?: () => Date;
}

export type CompressResult = { ok: true; memory: AppMemory } | { ok: false; error: string };

/** 대화를 기억으로 압축한다. 코드가 아는 사실(요구사항 상태, 선언의 참고)은 엔진 답 위에 덮어 쓴다 */
export async function compress(i: CompressInput, d: CompressDeps): Promise<CompressResult> {
  if (countable(i.messages).length === 0) return { ok: false, error: '압축할 대화가 없어요' };
  let text: string;
  try {
    text = await d.ask(memoryPrompt(i));
  } catch (err) {
    return { ok: false, error: `기억 정리 엔진이 답하지 못했어요: ${(err as Error).message}` };
  }
  const m = normalizeMemory(extractJson(text), basedOnOf(i.messages), (d.now ?? (() => new Date()))());
  if (!m) return { ok: false, error: `기억 정리 결과를 읽지 못했어요: ${text.slice(0, 160)}` };
  // 진행 기록이 아는 요구사항이 있으면 그것이 진짜다(상태 포함). 엔진 것은 그것이 없을 때만
  if (i.requirements.length) m.requirements = i.requirements;
  // 선언의 참고는 정확한 커밋·라이선스를 가졌으므로 같은 저장소의 엔진 답을 그것으로 바꾸고 why는 엔진 것을 살린다
  for (const r of i.manifestReferences) {
    const mine = m.references.find((x) => x.repo === r.repo);
    if (mine) Object.assign(mine, { ...r, why: mine.why });
    else m.references.push({ ...r, why: '' });
  }
  return { ok: true, memory: m };
}
