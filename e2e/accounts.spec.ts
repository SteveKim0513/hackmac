import { expect, test, type Page } from '@playwright/test';
import { launchApp, type AppHandle } from './helpers';

// 같은 회사 계정 추가·수동 전환. 가짜 CLI가 계정 설정 폴더(CLAUDE_CONFIG_DIR) 안 표시 파일로 로그인 여부를 가른다.
// 추가한 계정의 로그인은 모두 같은 메일(second@example.com)로 나온다 — 중복 경고 시험에 쓴다.

let handle: AppHandle | null = null;
test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

const openApp = async (): Promise<Page> => {
  handle = await launchApp({ claude: 'in' });
  const page = handle.page;
  await page.locator('.accounts-button').click({ timeout: 10_000 });
  await expect(page.locator('.accounts-card')).toBeVisible();
  return page;
};

const claude = (page: Page) => page.locator('[data-account-vendor="claude"]');

/** 계정 추가 → 로그인(브라우저 코드 붙여넣기까지) */
const addAndLogin = async (page: Page, id: string) => {
  await claude(page).locator('[data-add-account="claude"]').click();
  const row = claude(page).locator(`[data-account="${id}"]`);
  await expect(row.locator('.account-status')).toHaveText('로그인이 필요해요');
  await row.locator(`[data-login-start="${id}"]`).click();
  await expect(row.locator('[data-login="pending"] input')).toBeVisible({ timeout: 10_000 });
  await row.locator('[data-login="pending"] input').fill('browser-code');
  await row.locator('[data-login="pending"] button[type="submit"]').click();
  await expect(row.locator('.account-status')).toContainText('second@example.com', { timeout: 15_000 });
  return row;
};

test('계정 추가 → 로그인 → "이 계정으로 쓰기"로 수동 전환', async () => {
  const page = await openApp();
  const def = claude(page).locator('[data-account="claude-default"]');
  await expect(def.locator('.account-badge')).toHaveText('쓰는 중');
  await expect(def.locator('.account-status')).toContainText('fake@example.com');

  const row = await addAndLogin(page, 'claude-2');
  // 로그인했다고 저절로 바뀌지 않는다(자동 전환 없음)
  await expect(def.locator('.account-badge')).toHaveText('쓰는 중');
  await expect(row.locator('.account-badge')).toHaveCount(0);

  await row.locator('[data-use-account="claude-2"]').click();
  await expect(row.locator('.account-badge')).toHaveText('쓰는 중');
  await expect(def.locator('.account-badge')).toHaveCount(0);
  await expect(def.locator('[data-use-account="claude-default"]')).toBeVisible();
});

test('한 회사에 3개까지, 같은 계정 두 번 로그인하면 경고, 삭제는 한 번 더 확인', async () => {
  const page = await openApp();
  await addAndLogin(page, 'claude-2');
  const third = await addAndLogin(page, 'claude-3');
  await expect(third.locator('.account-warn')).toContainText('계정 2과(와) 같은 계정이에요');
  await expect(claude(page).locator('[data-add-account="claude"]')).toHaveCount(0);

  await third.locator('[data-delete-account="claude-3"]').click();
  await expect(third).toBeVisible();
  await third.locator('[data-confirm-delete="claude-3"]').click();
  await expect(claude(page).locator('[data-account="claude-3"]')).toHaveCount(0);
  await expect(claude(page).locator('[data-add-account="claude"]')).toBeVisible();
  // 기본 계정에는 삭제가 없다
  await expect(claude(page).locator('[data-account="claude-default"] [data-delete-account]')).toHaveCount(0);
});

test('이름 바꾸기', async () => {
  const page = await openApp();
  await claude(page).locator('[data-add-account="claude"]').click();
  const row = claude(page).locator('[data-account="claude-2"]');
  await row.getByText('이름 바꾸기').click();
  await row.locator('input').fill('회사');
  await row.locator('button[type="submit"]').click();
  await expect(row.locator('.account-label')).toHaveText('회사');
});

test('만들던 앱의 계정을 옮긴다: 알림 글이 남고, 이후 글은 새 계정으로 이어진다', async () => {
  const page = await openApp();
  await addAndLogin(page, 'claude-2');
  await page.locator('.accounts-card .modal-actions button').click();

  await page.locator('.create-app-button').click();
  await page.locator('.composer textarea').fill('안녕');
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.bubble-assistant').last()).toHaveText('echo:안녕', { timeout: 10_000 });

  const select = page.locator('[data-thread-account]');
  await expect(select).toHaveValue('claude-default');
  await expect(select.locator('option')).toHaveCount(2);
  await select.selectOption('claude-2');
  // 가짜 CLI는 디스크에 세션 기록을 안 남기므로 복사할 원본이 없다 → 새 대화로 시작한다고 알린다(맥락은 끊기고 글은 남는다)
  await expect(page.locator('.bubble-notice').last()).toContainText('쓰는 계정을 바꿨어요: 계정 2', { timeout: 10_000 });
  await expect(page.locator('.bubble-notice').last()).toContainText('새 대화로 시작해요');
  await expect(select).toHaveValue('claude-2');
  await expect(page.locator('.bubble-user')).toHaveText('안녕');

  await page.locator('.composer textarea').fill('이어서');
  await page.locator('.composer textarea').press('Enter');
  await expect(page.locator('.bubble-assistant').last()).toHaveText('echo:이어서', { timeout: 10_000 });
});
