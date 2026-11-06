import { describe, expect, it } from 'vitest';
import { classify } from './classify.ts';

const fail = (log: string, code: number | null = 1, signal: string | null = null) => classify({ code, signal, log, appName: '미리알림 GTD' });

describe('classify', () => {
  it('성공이면 null', () => {
    expect(fail('ok', 0)).toBeNull();
  });

  it('자동화 권한 거부(-1743)는 권한, 대상 앱 이름과 설정 열기를 안내한다 — execution error보다 먼저 본다', () => {
    const d = fail('[2026-11-06 10:00:00.000] 07:12: execution error: Not authorized to send Apple events to Reminders. (-1743)')!;
    expect(d.cause).toBe('permission');
    expect(d.summary).toBe('Reminders 조작 권한이 꺼져 있어요');
    expect(d.advice).toMatchObject({ title: '미리알림 GTD에 권한이 필요해요', action: { label: '설정 열기', url: expect.stringContaining('Privacy_Automation') } });
    expect(d.evidence).toContain('Not authorized to send Apple events to Reminders');
  });

  it('손쉬운 사용·전체 디스크 접근도 권한이고 각자의 설정 창으로 안내한다', () => {
    expect(fail('osascript is not allowed assistive access. (-25211)')!.advice!.action!.url).toContain('Privacy_Accessibility');
    expect(fail('cat: /Users/x/Library/Mail/foo: Operation not permitted')!.advice!.action!.url).toContain('Privacy_AllFiles');
  });

  it('인터넷 끊김은 network(안내만), 5xx·한도는 external(안내만)', () => {
    const n = fail('curl: (6) Could not resolve host: api.example.com')!;
    expect(n).toMatchObject({ cause: 'network', summary: '인터넷에 연결되지 않았어요' });
    expect(n.advice!.action).toBeUndefined();
    expect(fail('curl: (22) The requested URL returned error: 503')!.cause).toBe('external');
    expect(fail('HTTP/2 429 \n rate limit')!.cause).toBe('external');
  });

  it('코드 문제: 문법·없는 명령·못 찾는 대상', () => {
    expect(fail('./a.sh:12: parse error near `fi`')!.cause).toBe('code');
    expect(fail('zsh: command not found: jq')!.cause).toBe('code');
    expect(fail('execution error: Can’t get list "GTD 업무". (-1728)')!.cause).toBe('code');
    expect(fail('x')!.advice).toBeNull();
  });

  it('어디에도 없으면 unknown, 끊긴 신호도 말해 준다', () => {
    expect(fail('아무 말 없음', 3)).toMatchObject({ cause: 'unknown', summary: '앱이 오류로 끝났어요(코드 3)', evidence: '아무 말 없음' });
    expect(fail('', null, 'SIGKILL')!.summary).toBe('앱이 중간에 끊겼어요(SIGKILL)');
  });

  it('서명: 같은 문제는 숫자·경로·시각이 달라도 같고, 다른 문제는 다르다', () => {
    const a = fail('[10:00:01.123] /Users/a/app/scripts/x.sh:12: command not found: foo')!;
    const b = fail('[11:30:59.999] /Users/b/other/scripts/x.sh:98: command not found: foo')!;
    const c = fail('[11:30:59.999] /Users/b/other/scripts/x.sh:98: command not found: bar')!;
    expect(a.signature).toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
  });
});
