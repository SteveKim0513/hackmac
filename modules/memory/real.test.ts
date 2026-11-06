/**
 * 진짜 엔진으로 기억 압축과 레시피를 본다(구독 사용량을 조금 쓰므로 평소엔 건너뛴다):
 *   HACKMAC_REAL_ENGINES=1 npx vitest run modules/memory/real.test.ts
 * 핵심 질문: 개인 값(캘린더 이름·메일·API 키·내 경로)이 가득한 대화에서, 레시피에 그 값이 새지 않는가?
 * 새지 않는 것은 (1) 엔진이 환경 사실을 요구사항에서 빼 빈칸으로 분리하고 (2) 코드가 메일·키·경로를 한 번 더 가리기 때문이다.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanEnv, cliStatus, envFor, type Vendor } from '../account/cli.ts';
import { askOnce } from '../conversation/once.ts';
import { buildRecipe } from '../recipe/recipe.ts';
import type { Message } from '../thread/thread.ts';
import { compress } from './memory.ts';

const REAL = process.env.HACKMAC_REAL_ENGINES === '1';
const root = realpathSync(mkdtempSync(join(tmpdir(), 'hackmac-realmem-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const m = (role: Message['role'], text: string, i: number): Message => ({ at: new Date(Date.UTC(2026, 10, 6, 10, i)).toISOString(), role, text });
const CONVO: Message[] = [
  m('user', '단축키를 누르면 오늘 일정을 알림으로 보여 주는 앱을 만들고 싶어. 내 회사 캘린더 이름은 "Acme 영업팀"이야.', 0),
  m('assistant', '알겠어요. 알림 배너로 보여 줄까요, 창으로 보여 줄까요?', 1),
  m('user', '배너로. 창은 회의 중에 방해돼서 싫어. 일정이 없으면 "오늘은 일정이 없어요"라고 해 줘.', 2),
  m('assistant', '정리할게요. 날짜 범위로 일정을 찾으면 20초 넘게 걸려서, 오늘 일정은 이름 목록을 통째로 읽어 거르는 방식으로 할게요.', 3),
  m('user', '응 좋아. 일정 알림은 jiho.kim@imaginefutures.co 로도 한 번 보내 줘. 그리고 내 폴더는 /Users/jiho-mac/Documents/일정이야.', 4),
  m('assistant', '메일 발송은 이 앱의 능력 밖이라 빼고, 알림만 보여 줄게요. 폴더 경로는 설정으로 받을게요.', 5),
  m('user', '그럼 일정 소스는 캘린더 말고 내 개인 API로도 받고 싶은데, 키는 sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef 야.', 6),
  m('assistant', '그 키는 앱 설정의 비밀값으로 받을게요. 채팅에는 더 적지 마세요.', 7),
];

for (const vendor of ['claude', 'codex'] as Vendor[]) {
  describe.skipIf(!REAL)(`실제 ${vendor} 기억 압축과 레시피`, () => {
    it('개인 값이 든 대화를 압축해도 레시피에 개인 값이 새지 않는다', async () => {
      const st = await cliStatus(vendor);
      expect(st.status?.loggedIn).toBe(true);
      const r = await compress(
        { messages: CONVO, previous: null, requirements: [], manifestReferences: [] },
        {
          ask: async (prompt) => {
            const cwd = realpathSync(mkdtempSync(join(root, 'w-')));
            return askOnce(vendor, { bin: st.bin!, cwd, env: envFor(st.bin!, {}, cleanEnv()), allowedTools: [] }, prompt, 300_000);
          },
        },
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      const mem = r.memory;
      console.log(`[${vendor}] 기억:\n${JSON.stringify(mem, null, 1)}`);
      expect(mem.goal.length).toBeGreaterThan(5);
      expect(mem.requirements.length).toBeGreaterThan(0);
      expect(mem.environment.length).toBeGreaterThan(0);
      expect(mem.environment.some((e) => e.blank !== '')).toBe(true);

      const recipe = buildRecipe(mem);
      console.log(`[${vendor}] 레시피:\n${recipe.text}\n경고: ${JSON.stringify(recipe.warnings)}`);
      // 개인 값은 어디에도 없어야 한다
      for (const secret of ['Acme', '영업팀', 'imaginefutures', 'jiho.kim', 'jiho-mac', 'sk-ant', 'ABCDEFGHIJKLMNOP']) {
        expect(recipe.text, `레시피에 "${secret}"가 새어 나감`).not.toContain(secret);
      }
      // 구조는 유지된다
      expect(recipe.text.split('\n')[0]).toBe('HackMac 레시피 v1');
      expect(recipe.blanks.length).toBeGreaterThan(0);
      expect(recipe.text).toContain('___');
      // 시도했다 버린 방법(날짜 범위 필터)은 함정으로 남는 것이 좋다 — 필수는 아니라 출력만 본다
      console.log(`[${vendor}] 함정 ${mem.tried.length}개, 결정 ${mem.decisions.length}개`);
    }, 400_000);
  });
}
