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

const onlyVendor = process.env.HACKMAC_REAL_VENDOR;

for (const vendor of ['claude', 'codex'] as const) {
  test(`진짜 ${vendor}: 단순한 앱을 처음부터 끝까지 만든다(평가·검증·설치)`, async () => {
    test.skip(Boolean(onlyVendor) && onlyVendor !== vendor);
    test.setTimeout(1_200_000);
    handle = await launchApp({ real: true });
    const { page } = handle;
    const ask = page.locator('.onboarding h1');
    const create = page.locator('.create-app-button');
    await expect(ask.or(create)).toBeVisible({ timeout: 30_000 });
    if (await ask.isVisible()) await page.locator(`.vendor-card[data-vendor="${vendor}"] button`).click();
    await create.click();
    // 끝난 답만 센다(쓰는 중·생각하는 중 말풍선 제외). 보낸 직후엔 보내기 버튼이 잠깐 그대로라 버튼만 보면 "끝났다"고 착각한다(실제로 겪음)
    const finished = page.locator('.bubble-assistant:not(.is-streaming):not(.is-typing)');
    const say = async (text: string) => {
      const before = await finished.count();
      await page.locator('.composer textarea').fill(text);
      await page.locator('.composer textarea').press('Enter');
      await expect(finished).toHaveCount(before + 1, { timeout: 900_000 });
      await expect(page.locator('.composer button[type="submit"]')).toBeVisible({ timeout: 900_000 });
    };
    const threadId = await page.evaluate(async () => (await window.studio.threads())[0].meta.id);
    await say('단축키를 누르면 오늘 날짜와 요일을 알림 배너로 보여 주는 앱을 만들어 줘. 설정은 필요 없어. 요구는 이게 전부고, 확인 질문 없이 바로 끝까지 만들어 줘.');
    const done = page.locator('.build-box.is-done');
    for (let turn = 1; turn <= 6; turn++) {
      console.log(`[${vendor} 턴 ${turn}] ${(await finished.last().textContent())?.slice(0, 400)}`);
      if (await done.isVisible()) break;
      await say('네, 그대로 진행해 주세요. 끝까지 만들어서 설치해 주세요.');
    }
    const state = await page.evaluate((id) => window.studio.build(id), threadId);
    console.log(`[${vendor}] 최종 상태`, JSON.stringify({ step: state?.step, req: state?.requirements, verdict: state?.verdict?.kind, gate: state?.gate?.ok, installed: state?.installed, log: state?.log.map((l) => l.text) }, null, 1));
    await expect(done).toBeVisible();
    await page.locator('.build-box.is-done button').click();
    await expect(page.locator('.detail-page')).toBeVisible();
    console.log(`[${vendor}] 앱 이름: ${await page.locator('.detail-page h1').textContent()} · 단축키: ${(await page.locator('.shortcut-table tbody tr').allTextContents()).join(' | ')}`);
  });

  test(`진짜 ${vendor}: 앱 만들기 → 요구를 말하면 한국어로 되묻는다`, async () => {
    test.skip(Boolean(onlyVendor) && onlyVendor !== vendor);
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
