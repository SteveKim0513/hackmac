import { expect, test } from '@playwright/test';
import { launchApp, type AppHandle } from './helpers';

// 앱 상세의 [수정하기]: 설치된 앱의 채팅이 다시 열리고, 고친 앱이 새 버전으로 설치된다.
// 가짜 엔진의 "build-demo"가 요구 정리 → 평가 → handoff를 하고, 전문 담당들(가짜)이 수정이면 버전을 올린다.

let handle: AppHandle | null = null;
test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

const send = async (page: import('@playwright/test').Page, text: string) => {
  await page.locator('.composer textarea').fill(text);
  await expect(page.locator('.composer button[type=submit]')).toBeEnabled();
  await page.locator('.composer textarea').press('Enter');
};

test('만든 앱을 상세에서 [수정하기] → 같은 채팅이 다시 열리고, 고치면 2번째 버전으로 설치된다', async () => {
  handle = await launchApp({ claude: 'in' });
  const page = handle.page;
  await page.locator('.create-app-button').click({ timeout: 10_000 });
  await send(page, 'build-demo');
  await expect(page.locator('.build-box.is-done')).toBeVisible({ timeout: 60_000 });
  await page.locator('.build-box.is-done button').click();
  await expect(page.locator('.detail-page h1')).toHaveText('오늘 날짜');

  // 수정하기 → 같은 스레드(지난 대화가 있다), 수정 시작 알림, 진행은 처음부터
  await page.locator('.edit-app-button').click();
  await expect(page.locator('.bubble-user').first()).toHaveText('build-demo');
  await expect(page.locator('.bubble-notice').last()).toContainText('이 앱을 고치기 시작해요(지금 1번째 버전)');
  await expect(page.locator('.build-box.is-done')).toHaveCount(0);
  await expect(page.locator('.step-list li.is-current')).toContainText('요구 정리');
  // 기존 요구사항은 그대로 남는다
  await expect(page.locator('.req-row .req-text')).toHaveText(['단축키를 누르면 오늘 날짜를 알림으로 보여 준다']);

  // 홈의 "만드는 중"에 "고치는 중"으로 다시 보인다
  await page.locator('.titlebar-back').click();
  const card = page.locator('.thread-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('고치는 중');
  await card.click();

  // 고친다 → 검증·감사를 다시 거쳐 2번째 버전으로 설치
  await send(page, 'build-demo');
  await expect(page.locator('.build-box.is-done')).toBeVisible({ timeout: 60_000 });
  await page.locator('.build-log summary').click();
  await expect(page.locator('.build-log')).toContainText('설치됨: my.today (이 맥의 2번째 버전)');
  await expect(page.locator('[data-audit] strong')).toHaveText('목표 확인 7/7');

  // 고치기가 끝나면 "만드는 중"에서 다시 빠진다
  await page.locator('.titlebar-back').click();
  await expect(page.locator('.thread-card')).toHaveCount(0);
});

test('작업실 밖에서 온 앱(기본 앱)도 [수정하기]하면 새 채팅이 그 앱에 붙어 열린다', async () => {
  handle = await launchApp({ claude: 'in' });
  const page = handle.page;
  // 기본으로 들어 있는 GTD 앱
  const details = page.locator('[data-card-details="hackmac.gtd-reminders"]');
  await details.click({ timeout: 10_000 });
  await page.locator('.edit-app-button').click();
  await expect(page.locator('.bubble-notice').last()).toContainText('이 앱을 고치기 시작해요');
  await expect(page.locator('.chat-empty')).toHaveCount(0);
  // 다시 [수정하기]를 눌러도 같은 스레드로 간다(새로 만들지 않는다)
  await page.locator('.titlebar-back').click();
  await expect(page.locator('.thread-card')).toHaveCount(1);
});
