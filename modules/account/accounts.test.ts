import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountStore, configDirOf, defaultId } from './accounts.ts';
import { copySession } from './session.ts';

let tmp: string;
let file: string;
let root: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hackmac-accounts-'));
  file = join(tmp, 'accounts.json');
  root = join(tmp, 'accounts');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('AccountStore', () => {
  it('처음엔 회사마다 기본 계정만 있고 그게 지금 쓰는 계정이다', () => {
    const s = new AccountStore(file, root);
    expect(s.list().map((a) => [a.id, a.vendor, a.configDir])).toEqual([['claude-default', 'claude', null], ['codex-default', 'codex', null]]);
    expect(s.activeId('claude')).toBe('claude-default');
    expect(s.env('claude-default')).toEqual({});
  });

  it('계정을 추가하면 계정마다 따로 설정 폴더가 생기고 환경변수가 그 폴더를 가리킨다', () => {
    const s = new AccountStore(file, root);
    const a = s.add('claude');
    expect(a).toMatchObject({ ok: true, account: { id: 'claude-2', label: '계정 2', configDir: join(root, 'claude-2') } });
    expect(existsSync(join(root, 'claude-2'))).toBe(true);
    const b = s.add('codex', '  회사 계정  ');
    expect(b).toMatchObject({ ok: true, account: { id: 'codex-2', label: '회사 계정' } });
    expect(s.env('claude-2')).toEqual({ CLAUDE_CONFIG_DIR: join(root, 'claude-2') });
    expect(s.env('codex-2')).toEqual({ CODEX_HOME: join(root, 'codex-2') });
  });

  it('한 회사에 최대 3개(기본 포함). 지우면 번호는 비어도 다시 만들 수 있다', () => {
    const s = new AccountStore(file, root);
    s.add('claude');
    s.add('claude');
    expect(s.add('claude')).toEqual({ ok: false, error: '계정은 한 회사에 최대 3개까지예요' });
    expect(s.add('codex')).toMatchObject({ ok: true });
    s.remove('claude-2');
    expect(s.add('claude')).toMatchObject({ ok: true, account: { id: 'claude-2' } });
  });

  it('수동 전환은 회사별로 따로, 재시작해도 남는다', () => {
    const s = new AccountStore(file, root);
    s.add('claude');
    expect(s.setActive('claude-2')).toBe(true);
    expect(s.active('claude').id).toBe('claude-2');
    expect(s.active('codex').id).toBe('codex-default');
    expect(s.setActive('claude-9')).toBe(false);
    const again = new AccountStore(file, root);
    expect(again.activeId('claude')).toBe('claude-2');
    expect(again.list('claude').map((a) => a.id)).toEqual(['claude-default', 'claude-2']);
  });

  it('쓰던 계정을 지우면 기본 계정으로 돌아가고, 그 폴더(로그인 정보 포함)도 지운다. 기본 계정은 못 지운다', () => {
    const s = new AccountStore(file, root);
    s.add('claude');
    writeFileSync(join(root, 'claude-2', 'creds'), 'x');
    s.setActive('claude-2');
    expect(s.remove('claude-2')).toBe(true);
    expect(s.activeId('claude')).toBe('claude-default');
    expect(existsSync(join(root, 'claude-2'))).toBe(false);
    expect(s.remove('claude-default')).toBe(false);
    expect(s.list('claude')).toHaveLength(1);
  });

  it('이름 바꾸기', () => {
    const s = new AccountStore(file, root);
    s.add('claude');
    expect(s.rename('claude-2', '  개인  ')).toBe(true);
    expect(s.get('claude-2')!.label).toBe('개인');
    expect(s.rename('claude-2', '   ')).toBe(false);
    expect(s.rename('claude-default', '이름')).toBe(false);
  });

  it('깨진 파일이나 이상한 항목은 버리고 기본 계정으로 시작한다', () => {
    writeFileSync(file, '{깨짐');
    expect(new AccountStore(file, root).list()).toHaveLength(2);
    writeFileSync(file, JSON.stringify({ schema: 1, accounts: [{ id: '../evil', vendor: 'claude', label: 'x' }, { id: 'codex-2', vendor: 'claude', label: 'x' }, { id: 'claude-3', vendor: 'claude', label: '좋음' }], active: { claude: 'claude-7', codex: 'codex-default' } }));
    const s = new AccountStore(file, root);
    expect(s.list('claude').map((a) => a.id)).toEqual(['claude-default', 'claude-3']);
    expect(s.activeId('claude')).toBe('claude-default');
  });

  it('configDirOf: 기본 계정은 CLI 기본 위치(환경변수 우선)', () => {
    const s = new AccountStore(file, root);
    expect(configDirOf(s.get('claude-default')!, '/h', {})).toBe('/h/.claude');
    expect(configDirOf(s.get('codex-default')!, '/h', { CODEX_HOME: '/x' })).toBe('/x');
    expect(defaultId('codex')).toBe('codex-default');
  });
});

describe('copySession', () => {
  const S = '672ca488-4d8f-48c9-934b-b3e84cc3a4af';

  it('Claude: 세션 파일이 든 프로젝트 폴더 이름 그대로, 도구 결과 폴더까지 복사하고 원본은 둔다', () => {
    const from = join(tmp, 'from');
    const to = join(tmp, 'to');
    const proj = '-Users-x-Projects-app--claude-worktrees-w';
    mkdirSync(join(from, 'projects', proj, S, 'tool-results'), { recursive: true });
    writeFileSync(join(from, 'projects', proj, `${S}.jsonl`), '{"a":1}\n');
    writeFileSync(join(from, 'projects', proj, S, 'tool-results', 'r.txt'), 'out');
    writeFileSync(join(from, 'projects', proj, 'other.jsonl'), 'no');
    const r = copySession('claude', from, to, S);
    expect(r).toEqual({ ok: true, copied: [`${S}.jsonl`, `${S}/`] });
    expect(readFileSync(join(to, 'projects', proj, `${S}.jsonl`), 'utf8')).toBe('{"a":1}\n');
    expect(readFileSync(join(to, 'projects', proj, S, 'tool-results', 'r.txt'), 'utf8')).toBe('out');
    expect(existsSync(join(to, 'projects', proj, 'other.jsonl'))).toBe(false);
    expect(existsSync(join(from, 'projects', proj, `${S}.jsonl`))).toBe(true);
  });

  it('Codex: 날짜 폴더 구조 그대로 복사', () => {
    const from = join(tmp, 'from');
    const to = join(tmp, 'to');
    const id = '01a1af86-45a5-79d0-b674-a6a67dd409d6';
    const rel = join('2026', '11', '06', `rollout-2026-11-06T15-22-55-${id}.jsonl`);
    mkdirSync(join(from, 'sessions', '2026', '11', '06'), { recursive: true });
    writeFileSync(join(from, 'sessions', rel), 'rollout');
    expect(copySession('codex', from, to, id)).toEqual({ ok: true, copied: [rel] });
    expect(readFileSync(join(to, 'sessions', rel), 'utf8')).toBe('rollout');
  });

  it('원본이 없거나 세션 번호가 이상하면 이유를 돌려준다(경로 탈출 포함)', () => {
    const from = join(tmp, 'from');
    mkdirSync(join(from, 'projects'), { recursive: true });
    expect(copySession('claude', from, join(tmp, 'to'), S)).toMatchObject({ ok: false, reason: 'no-source' });
    expect(copySession('codex', from, join(tmp, 'to'), S)).toMatchObject({ ok: false, reason: 'no-source' });
    expect(copySession('claude', from, join(tmp, 'to'), '../../etc')).toMatchObject({ ok: false, reason: 'bad-session' });
    expect(existsSync(join(tmp, 'to'))).toBe(false);
  });
});
