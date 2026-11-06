import { expect, test } from '@playwright/test';
import { launchApp, type AppHandle, type LaunchOptions } from './helpers';

// 작업실: 첫 실행 엔진 선택 → 앱 만들기 → 채팅. 진짜 CLI 대신 가짜 CLI(modules/conversation/fixtures)를 쓴다.
// 가짜 엔진은 "echo:<글>"로 답한다.

let handle: AppHandle | null = null;
const open = async (o: LaunchOptions) => {
  handle = await launchApp(o);
  return handle.page;
};

test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

test('둘 다 로그인돼 있으면 한 번 묻고, 고르면 홈으로 간다', async () => {
  const page = await open({ claude: 'in', codex: 'in' });
  await expect(page.locator('.onboarding h1')).toHaveText('어떤 AI로 앱을 만들까요?', { timeout: 10_000 });
  await page.locator('.vendor-card[data-vendor="codex"] button').click();
  await expect(page.locator('.create-app-button')).toBeVisible();
});

test('로그인한 엔진이 없으면 로그인 화면, 설치 안 된 쪽은 그렇게 말한다', async () => {
  const page = await open({ claude: 'out', codex: 'none' });
  await expect(page.locator('.onboarding h1')).toHaveText('AI 계정에 로그인해 주세요', { timeout: 10_000 });
  await expect(page.locator('.vendor-card[data-vendor="claude"] button')).toHaveText('로그인');
  await expect(page.locator('.vendor-card[data-vendor="codex"] .vendor-card-status')).toHaveText('이 Mac에 설치돼 있지 않아요');
});

for (const vendor of ['claude', 'codex'] as const) {
  test(`${vendor}: 앱 만들기 → 글을 보내면 답이 오고, 제목이 붙고, 홈에 "만드는 중"으로 남는다`, async () => {
    const page = await open(vendor === 'claude' ? { claude: 'in' } : { claude: 'none', codex: 'in' });
    await page.locator('.create-app-button').click({ timeout: 10_000 });
    await expect(page.locator('.thread-page')).toBeVisible();
    await page.locator('.composer textarea').fill('메뉴바에 시계');
    await page.locator('.composer textarea').press('Enter');
    await expect(page.locator('.bubble-user')).toHaveText('메뉴바에 시계');
    await expect(page.locator('.bubble-assistant').last()).toHaveText('echo:메뉴바에 시계', { timeout: 10_000 });
    await expect(page.locator('.thread-title')).toHaveText('메뉴바에 시계');
    await page.locator('.back-button').click();
    await expect(page.locator('.thread-card-title')).toHaveText('메뉴바에 시계');
    await page.locator('.thread-card').click();
    // 다시 열면 지난 대화가 그대로 있다
    await expect(page.locator('.bubble-assistant').last()).toHaveText('echo:메뉴바에 시계');
  });
}
