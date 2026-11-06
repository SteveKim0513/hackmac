import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('CLI가 없으면 "설치하기" → 설치 중 → 깔리면 로그인 단계로 넘어간다', async () => {
  const page = await open({ claude: 'none', codex: 'installable' });
  const card = page.locator('.vendor-card[data-vendor="codex"]');
  await expect(card.locator('.vendor-card-status')).toHaveText('이 Mac에 설치돼 있지 않아요', { timeout: 10_000 });
  await card.locator('button', { hasText: '설치하기' }).click();
  await expect(card.locator('[data-install="running"]')).toBeVisible();
  await expect(card.locator('.vendor-card-status')).toHaveText('로그인이 필요해요', { timeout: 15_000 });
  await expect(card.locator('button', { hasText: '로그인' })).toBeVisible();
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

for (const vendor of ['claude', 'codex'] as const) {
  test(`${vendor}: 제작 전 과정 — 요구사항 → 다른 역할의 평가 → 검증 → 설치 → 내 앱에 카드`, async () => {
    // 둘 다 로그인: 만드는 쪽이 아닌 회사가 평가한다(계획서 7.2)
    const page = await open({ claude: 'in', codex: 'in' });
    await page.locator(`.vendor-card[data-vendor="${vendor}"] button`).click({ timeout: 10_000 });
    await page.locator('.create-app-button').click();
    await page.locator('.composer textarea').fill('build-demo');
    await page.locator('.composer textarea').press('Enter');
    await expect(page.locator('.build-box.is-done')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.req-row.is-passed .req-text')).toHaveText('단축키를 누르면 오늘 날짜를 알림으로 보여 준다');
    await expect(page.locator('.build-box.is-verdict-possible strong')).toHaveText('가능성 평가: 가능');
    await expect(page.locator('.step-list li.is-done')).toHaveCount(5);
    await page.locator('.build-log summary').click();
    await expect(page.locator('.build-log')).toContainText('가능성 평가: possible');
    await expect(page.locator('.bubble-assistant').last()).toContainText('설치함: my.today', { timeout: 10_000 });
    await page.locator('.build-box.is-done button').click();
    await expect(page.locator('.detail-page h1')).toHaveText('오늘 날짜');
    await page.locator('.back-button').click();
    await expect(page.locator('.service-card-name')).toContainText(['오늘 날짜']);
    // 완성된 앱의 스레드는 "만드는 중"에서 빠진다
    await expect(page.locator('.thread-card')).toHaveCount(0);
  });
}

test('내보내기 → 새 HackMac에서 앱 파일 설치: 미리 보기 확인 후 설치, 내 앱에 카드', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'hackmac-export-'));
  try {
    // A: 제작 흐름으로 앱을 만들고 상세에서 내보낸다
    const a = await open({ claude: 'in', env: { HACKMAC_E2E_SAVE_DIR: outDir } });
    await a.locator('.create-app-button').click({ timeout: 10_000 });
    await a.locator('.composer textarea').fill('build-demo');
    await a.locator('.composer textarea').press('Enter');
    await expect(a.locator('.build-box.is-done')).toBeVisible({ timeout: 60_000 });
    await a.locator('.build-box.is-done button').click();
    await a.locator('.export-app-button').click();
    const file = join(outDir, 'my.today-v1.hackapp');
    await expect.poll(() => existsSync(file), { timeout: 10_000 }).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(100);
    await handle!.cleanup();
    handle = null;

    // B: 아무것도 없는 다른 HackMac. 파일로 설치한다
    const b = await open({ claude: 'in', env: { HACKMAC_E2E_PICK_FILE: file } });
    await expect(b.locator('.service-card-name')).not.toContainText(['오늘 날짜'], { timeout: 10_000 });
    await b.locator('.install-app-button').click();
    const dialog = b.locator('[data-bundle-preview="my.today"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('h2')).toHaveText('오늘 날짜');
    await expect(dialog).toContainText('서명이 없어요');
    await expect(dialog).toContainText('다른 앱이나 인터넷을 쓰지 않아요');
    // 취소하면 아무것도 설치되지 않는다
    await dialog.locator('button', { hasText: '취소' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(b.locator('.service-card-name')).not.toContainText(['오늘 날짜']);
    await b.locator('.install-app-button').click();
    await b.locator('[data-bundle-preview="my.today"] button', { hasText: '설치' }).click();
    await expect(b.locator('.service-card-name')).toContainText(['오늘 날짜'], { timeout: 10_000 });
    await expect(b.locator('.toast')).toContainText('내 앱에 넣었어요');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('깨진 앱 파일은 설치 창 없이 이유를 알려 준다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hackmac-badfile-'));
  try {
    const { writeFileSync } = await import('node:fs');
    const bad = join(dir, 'bad.hackapp');
    writeFileSync(bad, 'not a hackapp');
    const page = await open({ claude: 'in', env: { HACKMAC_E2E_PICK_FILE: bad } });
    await page.locator('.install-app-button').click({ timeout: 10_000 });
    await expect(page.locator('.toast-error')).toContainText('HackMac 앱 파일이 아니에요');
    await expect(page.locator('.modal-card')).toHaveCount(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
