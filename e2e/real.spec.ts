import { expect, test } from '@playwright/test';
import { launchApp, type AppHandle } from './helpers';

// 실제 앱 창에서 이 Mac의 진짜 CLI로 한 턴 대화한다. 구독 사용량을 조금 쓰므로 평소엔 건너뛴다:
//   HACKMAC_REAL_ENGINES=1 npx playwright test e2e/real.spec.ts
// 두 엔진이 다 로그인돼 있으면 첫 화면에서 고르는 단계가 있다 — 그걸 지나 각 엔진으로 한 번씩.

test.skip(process.env.HACKMAC_REAL_ENGINES !== '1', '실제 엔진 시험은 HACKMAC_REAL_ENGINES=1일 때만');
test.setTimeout(180_000);

let handle: AppHandle | null = null;
test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

for (const vendor of ['claude', 'codex'] as const) {
  test(`진짜 ${vendor}: 앱 만들기 → 요구를 말하면 한국어로 되묻는다`, async () => {
    handle = await launchApp({ real: true });
    const { page } = handle;
    const ask = page.locator('.onboarding h1');
    const create = page.locator('.create-app-button');
    await expect(ask.or(create)).toBeVisible({ timeout: 30_000 });
    if (await ask.isVisible()) await page.locator(`.vendor-card[data-vendor="${vendor}"] button`).click();
    await create.click();
    await page.locator('.composer textarea').fill('회의 10분 전에 화면에 크게 알려 주는 앱을 만들고 싶어');
    await page.locator('.composer textarea').press('Enter');
    const reply = page.locator('.bubble-assistant:not(.is-streaming):not(.is-typing)').last();
    await expect(reply).toHaveText(/[가-힣]/, { timeout: 150_000 });
    const text = await reply.textContent();
    console.log(`[${vendor}] ${text?.slice(0, 300)}`);
    await expect(page.locator('.bubble-error')).toHaveCount(0);
    await expect(page.locator('.thread-engine')).toContainText(vendor === 'claude' ? 'Claude' : 'ChatGPT');
  });
}
