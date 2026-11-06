import { expect, test } from '@playwright/test';
import { launchApp, type AppHandle } from './helpers';

// 레시피: 대화에서 기억을 압축해 레시피를 만들고, 다른 앱 만들기에 붙여넣으면 짧은 모드로 시작한다.
// 기억 정리는 가짜 엔진이 고정된 JSON으로 답한다(개인 값 "내 시간대는 서울"이 든 환경 사실 하나 포함).

let handle: AppHandle | null = null;
test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

const say = async (page: import('@playwright/test').Page, text: string, expectReply: string) => {
  await page.locator('.composer textarea').fill(text);
  // 입력이 React 상태에 반영돼 보내기 버튼이 켜진 뒤에 Enter를 누른다(안 기다리면 가끔 빈 글로 읽혀 안 나간다)
  await expect(page.locator('.composer button[type=submit]')).toBeEnabled();
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.bubble-assistant').last()).toHaveText(expectReply, { timeout: 10_000 });
};

test('대화 → 레시피 만들기(빈칸만, 개인 값은 안 나감) → 새 앱 만들기에 붙여넣으면 레시피로 시작', async () => {
  handle = await launchApp({ claude: 'in' });
  const page = handle.page;
  await page.locator('.create-app-button').click({ timeout: 10_000 });
  // 대화가 없으면 레시피 버튼이 없다
  await expect(page.locator('[data-make-recipe]')).toHaveCount(0);
  await say(page, '메뉴바에 시계를 넣고 싶어', 'echo:메뉴바에 시계를 넣고 싶어');
  await say(page, '내 시간대는 서울이야', 'echo:내 시간대는 서울이야');

  await page.locator('[data-make-recipe]').click();
  const dialog = page.locator('[data-recipe-dialog]');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const text = await dialog.locator('[data-recipe-text]').inputValue();
  expect(text.split('\n')[0]).toBe('HackMac 레시피 v1');
  expect(text).toContain('# 목표\n메뉴바에 시계를 보여 준다');
  expect(text).toContain('R1. 시계를 보여 준다');
  expect(text).toContain('- 24시간제로 보여 준다 — 사용자가 원해서');
  expect(text).toContain('- 시간대: ___');
  expect(text).toContain('- 이 방법은 쓰지 마세요: 초 단위 갱신 — 배터리를 많이 써서');
  expect(text).not.toContain('서울'); // 보낸 사람의 환경 값은 나가지 않는다
  await expect(dialog.locator('[data-recipe-blanks] li')).toHaveText(['시간대: ___']);
  await expect(dialog.locator('[data-recipe-refs]')).toHaveCount(0); // 참고가 없으면 참고 구역도 없다
  await expect(dialog.locator('[data-recipe-warnings]')).toContainText('참고한 오픈소스가 없어서');

  // 보내기 전에 글을 고칠 수 있다
  await dialog.locator('[data-recipe-text]').fill(`${text}\n(추가한 메모)`);
  await dialog.locator('[data-recipe-copy]').click();
  await expect(dialog.locator('.recipe-copied, .account-warn')).toBeVisible();
  const sent = await dialog.locator('[data-recipe-text]').inputValue();
  await dialog.locator('button', { hasText: '닫기' }).click();
  await expect(dialog).toHaveCount(0);

  // 다른 앱 만들기에 붙여넣는다
  await page.locator('.back-button').click();
  await page.locator('.create-app-button').click();
  await expect(page.locator('.chat-empty')).toContainText('레시피가 있으면 여기에 그대로 붙여넣으세요');
  await page.locator('.composer textarea').fill(sent);
  // 입력이 React 상태에 반영돼 보내기 버튼이 켜진 뒤에 Enter를 누른다(안 기다리면 가끔 빈 글로 읽혀 안 나간다)
  await expect(page.locator('.composer button[type=submit]')).toBeEnabled();
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.bubble-user')).toContainText('HackMac 레시피 v1');
  await expect(page.locator('.bubble-assistant').last()).toContainText('echo:HackMac 레시피 v1', { timeout: 10_000 });
  // 제목은 레시피 첫 줄이 아니라 목표다
  await expect(page.locator('.thread-title')).toHaveText('메뉴바에 시계를 보여 준다');
});

test('기억 압축은 같은 대화에서 두 번 하지 않는다 — 두 번째 레시피는 바로 나온다', async () => {
  handle = await launchApp({ claude: 'in' });
  const page = handle.page;
  await page.locator('.create-app-button').click({ timeout: 10_000 });
  await say(page, '시계를 넣고 싶어', 'echo:시계를 넣고 싶어');
  await page.locator('[data-make-recipe]').click();
  await expect(page.locator('[data-recipe-dialog]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-recipe-dialog] button', { hasText: '닫기' }).click();
  // 기억 파일이 만들어졌다
  const { readdirSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const threads = join(handle.userData, 'threads');
  const id = readdirSync(threads).find((n) => /^[0-9a-f-]{36}$/.test(n))!;
  expect(existsSync(join(threads, id, 'memory.json'))).toBe(true);
  const t0 = Date.now();
  await page.locator('[data-make-recipe]').click();
  await expect(page.locator('[data-recipe-dialog]')).toBeVisible({ timeout: 5_000 });
  expect(Date.now() - t0).toBeLessThan(3_000);
});
