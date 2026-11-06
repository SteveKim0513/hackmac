import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, type AppHandle } from './helpers';

// 앱 상세의 설정 화면: 선언한 settings·secrets가 입력칸이 되고, 바꾸면 저장되고, 필수가 비면 안내한다.
// 앱은 userData에 미리 심는다(제작 과정은 다른 시험이 본다).

let handle: AppHandle | null = null;
test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

const seed = (userData: string) => {
  const dir = join(userData, 'apps', 'my.cfg', 'v1');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'x.sh'), '#!/bin/zsh\necho ok\n');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      schema: 1, id: 'my.cfg', version: '1', author: { name: 'me', signature: null }, hackmac: { min: '0.1.0' },
      name: '설정 앱', icon: '⚙️', tagline: '{hotkey:go} 누르면', usage: ['{hotkey:go}'],
      triggers: [
        { kind: 'hotkey', script: 'scripts/x.sh', key: 'go', name: '실행', description: '실행한다' },
        { kind: 'schedule', script: 'scripts/x.sh', name: '매일 알림', atSetting: 'notify-at' },
      ],
      capabilities: {}, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false },
      settings: [
        { key: 'city', label: '도시', type: 'string', required: true },
        { key: 'notify-at', label: '알림 시각', type: 'time', default: '09:00' },
        { key: 'count', label: '보여 줄 개수', type: 'number', default: 3 },
        { key: 'sound', label: '소리', type: 'boolean', default: false },
        { key: 'mode', label: '모드', type: 'choice', options: ['간단히', '자세히'], default: '간단히' },
        { key: 'symbols', label: '종목', type: 'list', default: ['AAPL'] },
      ],
      secrets: [{ key: 'api-key', label: 'API 키' }],
      references: [],
    }),
  );
  writeFileSync(join(userData, 'apps', 'my.cfg', 'current'), '1\n');
};

const openDetail = async () => {
  handle = await launchApp({ claude: 'in', seed });
  const page = handle.page;
  const card = page.locator('.service-card', { hasText: '설정 앱' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  // 꺼진 앱(필수 설정이 비어 켤 수도 없다)도 카드의 [설정]으로 상세에 들어간다
  await page.locator('[data-card-details="my.cfg"]').click();
  await expect(page.locator('.detail-page h1')).toHaveText('설정 앱');
  return page;
};

test('설정 화면: 필수가 비면 안내하고, 채우면 저장돼 켤 수 있다. 값은 다시 열어도 남는다', async () => {
  const page = await openDetail();
  const box = page.locator('[data-app-settings]');
  await expect(box.locator('[data-settings-missing]')).toContainText('도시');

  // 필수 입력 → 안내가 사라진다
  const city = box.locator('[data-setting-input="city"]');
  await city.fill('서울');
  await city.blur();
  await expect(box.locator('[data-setting="city"] .setting-msg')).toHaveText('저장했어요');
  await expect(box.locator('[data-settings-missing]')).toHaveCount(0);

  // 시각·숫자·스위치·선택·목록
  await expect(box.locator('[data-setting-input="notify-at"]')).toHaveValue('09:00'); // 기본값
  await box.locator('[data-setting-input="notify-at"]').fill('07:30');
  await box.locator('[data-setting-input="notify-at"]').blur();
  await expect(box.locator('[data-setting="notify-at"] .setting-msg')).toHaveText('저장했어요');
  await box.locator('[data-setting-input="count"]').fill('5');
  await box.locator('[data-setting-input="count"]').blur();
  await box.locator('[data-setting-input="sound"]').check();
  await expect(box.locator('[data-setting="sound"]')).toContainText('켜짐');
  await box.locator('[data-setting-input="mode"]').selectOption('자세히');
  await box.locator('[data-setting-input="symbols"]').fill('AAPL\nMSFT\nNVDA');
  await box.locator('[data-setting-input="symbols"]').blur();
  await expect(box.locator('[data-setting="symbols"] .setting-msg')).toHaveText('저장했어요');

  // 바꾼 값에는 "기본값으로 되돌리기"가 생긴다
  await expect(box.locator('[data-setting="notify-at"] .setting-reset')).toContainText('09:00');

  // 목록으로 나갔다 다시 들어와도 그대로
  await page.locator('.titlebar-back').click();
  await page.locator('[data-card-details="my.cfg"]').click();
  const again = page.locator('[data-app-settings]');
  await expect(again.locator('[data-setting-input="city"]')).toHaveValue('서울');
  await expect(again.locator('[data-setting-input="notify-at"]')).toHaveValue('07:30');
  await expect(again.locator('[data-setting-input="count"]')).toHaveValue('5');
  await expect(again.locator('[data-setting-input="mode"]')).toHaveValue('자세히');
  await expect(again.locator('[data-setting-input="symbols"]')).toHaveValue('AAPL\nMSFT\nNVDA');

  // 되돌리기
  await again.locator('[data-setting="notify-at"] .setting-reset').click();
  await expect(again.locator('[data-setting-input="notify-at"]')).toHaveValue('09:00');

  // 이제 필수가 채워졌으니 켤 수 있다
  await page.locator('.toggle-button', { hasText: '꺼짐' }).click();
  await expect(page.locator('.toggle-button.is-active', { hasText: '켜짐' })).toBeVisible({ timeout: 10_000 });
});

test('비밀값: 저장만 되고 화면에 다시 보이지 않으며, 파일에 평문으로 남지 않는다', async () => {
  const page = await openDetail();
  const row = page.locator('[data-secret="api-key"]');
  await expect(row.locator('[data-secret-save]')).toBeDisabled();
  await row.locator('[data-secret-input]').fill('sk-E2E-TOP-SECRET');
  await row.locator('[data-secret-save]').click();
  await expect(row.locator('.setting-msg')).toHaveText('저장했어요');
  await expect(row.locator('[data-secret-input]')).toHaveValue('');
  await expect(row.locator('[data-secret-input]')).toHaveAttribute('placeholder', /입력됨/);
  await expect(page.locator('body')).not.toContainText('sk-E2E-TOP-SECRET');

  const file = join(handle!.userData, 'secrets.json');
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).not.toContain('TOP-SECRET');
  expect(readFileSync(join(handle!.userData, 'settings.json'), 'utf8')).not.toContain('TOP-SECRET');

  await row.locator('[data-secret-clear]').click();
  await expect(row.locator('[data-secret-input]')).toHaveAttribute('placeholder', '입력해 주세요');
});

test('설정이 없는 앱도 설정 구역은 있고 "조정할 설정이 없어요"라고 말한다', async () => {
  handle = await launchApp({
    claude: 'in',
    seed: (userData) => {
      const dir = join(userData, 'apps', 'my.plain', 'v1');
      mkdirSync(join(dir, 'scripts'), { recursive: true });
      writeFileSync(join(dir, 'scripts', 'x.sh'), '#!/bin/zsh\necho ok\n');
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
        schema: 1, id: 'my.plain', version: '1', author: { name: 'me', signature: null }, hackmac: { min: '0.1.0' },
        name: '단순 앱', icon: '🔹', tagline: '{hotkey:go}', usage: ['{hotkey:go}'],
        triggers: [{ kind: 'hotkey', script: 'scripts/x.sh', key: 'go', name: '실행', description: '실행한다' }],
        capabilities: {}, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false }, settings: [], secrets: [], references: [],
      }));
      writeFileSync(join(userData, 'apps', 'my.plain', 'current'), '1\n');
    },
  });
  const page = handle.page;
  await page.locator('[data-card-details="my.plain"]').click({ timeout: 10_000 });
  await expect(page.locator('[data-app-settings]')).toContainText('따로 조정할 설정이 없어요');
});
