import { expect, test } from '@playwright/test';
import { launchApp, type AppHandle } from './helpers';

let handle: AppHandle;

test.beforeEach(async () => {
  handle = await launchApp();
});

test.afterEach(async () => {
  await handle.cleanup();
});

test('스토어 화면에 번들 서비스가 카드로 뜬다', async () => {
  const { page } = handle;
  await page.waitForSelector('.service-card', { timeout: 10_000 });
  const names = await page.locator('.service-card-name').allTextContents();
  expect(names).toContain('미리알림 GTD');
});

test('서비스를 켜면 상세 페이지로 들어가고, 단축키 목록이 보인다', async () => {
  const { page } = handle;
  await page.waitForSelector('.service-card', { timeout: 10_000 });
  // ServiceGrid.tsx: 꺼진 카드를 누르면 켜질 뿐 상세로 들어가지 않는다 —
  // 켜진 카드를 눌러야 상세 페이지로 들어간다(App.tsx handleClick 참고).
  await page.click('.service-card');
  await page.waitForSelector('.status-pill-active', { timeout: 10_000 });
  await page.click('.service-card');
  await page.waitForSelector('.detail-page', { timeout: 10_000 });
  await expect(page.locator('.toggle-button')).toHaveClass(/is-active/);
  const shortcutCount = await page.locator('.shortcut-table tbody tr').count();
  expect(shortcutCount).toBeGreaterThan(0);
});
