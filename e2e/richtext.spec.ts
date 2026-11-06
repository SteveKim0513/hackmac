import { expect, test } from '@playwright/test';
import { launchApp, type AppHandle } from './helpers';

// 채팅 글의 서식(굵게·목록)과 용어 설명 팝업. 가짜 엔진이 사용자 글을 "echo:<글>"로 돌려주므로
// 사용자가 마크다운으로 쓴 글이 어시스턴트 말풍선에서 어떻게 그려지는지 볼 수 있다.

let handle: AppHandle | null = null;
test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

const send = async (page: import('@playwright/test').Page, text: string) => {
  await page.locator('.composer textarea').fill(text);
  await expect(page.locator('.composer button[type=submit]')).toBeEnabled();
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.bubble-assistant').last()).toBeVisible({ timeout: 10_000 });
};

test('어시스턴트 글은 서식으로 보이고(별표가 그대로 안 보인다), 사용자 글은 그대로다', async () => {
  handle = await launchApp({ claude: 'in' });
  const page = handle.page;
  await page.locator('.create-app-button').click({ timeout: 10_000 });
  await send(page, '**굵은 말**과 보통 말\n\n1. 첫째\n2. 둘째\n\n- 점 하나');

  const bubble = page.locator('.bubble-assistant').last();
  await expect(bubble.locator('strong')).toHaveText('굵은 말');
  await expect(bubble.locator('ol li')).toHaveText(['첫째', '둘째']);
  await expect(bubble.locator('ul li')).toHaveText(['점 하나']);
  expect(await bubble.innerText()).not.toContain('**');
  // 사용자가 쓴 글은 서식 없이 보낸 그대로
  await expect(page.locator('.bubble-user').last()).toContainText('**굵은 말**과 보통 말');
});

test('모르는 단어는 점선으로 표시되고, 올리면 설명이 뜨고, 누르면 고정되고, Esc로 닫힌다', async () => {
  handle = await launchApp({ claude: 'in' });
  const page = handle.page;
  await page.locator('.create-app-button').click({ timeout: 10_000 });
  await send(page, '고른 주식을 **알림 배너**로 보여 줘요. 알림 배너는 또 나와도 한 번만 표시해요');

  const bubble = page.locator('.bubble-assistant').last();
  const term = bubble.locator('.term');
  await expect(term).toHaveCount(1); // 같은 단어는 글 하나에서 처음 한 번만
  await expect(term).toHaveText('알림 배너');
  const pop = page.locator('[data-term-pop]');
  await expect(pop).toHaveCount(0);

  // 올리면 뜬다, 벗어나면 사라진다
  await term.hover();
  await expect(pop).toBeVisible();
  await expect(pop).toContainText('화면 오른쪽 위에 잠깐 떴다가 사라지는');
  await page.mouse.move(5, 5);
  await expect(pop).toHaveCount(0);

  // 누르면 고정돼서 마우스가 벗어나도 남는다
  await term.click();
  await page.mouse.move(5, 5);
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);

  // 키보드로 가도 뜬다(접근성)
  await term.blur(); // 눌러서 이미 포커스가 있으면 focus 이벤트가 안 생긴다
  await term.focus();
  await expect(pop).toBeVisible();
});
