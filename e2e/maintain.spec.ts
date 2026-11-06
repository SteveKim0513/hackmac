import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, type AppHandle } from './helpers';

// 앱 상세의 유지보수: 대기 중인 수정본을 적용하거나 버린다. 수정본은 팀이 만들어 둔 것으로 userData에 미리 심는다
// (팀이 고치는 과정 자체는 modules/maintain 시험이 본다). 전역 단축키는 눌러지지 않으므로 단축키 실행은 보지 않는다.

let handle: AppHandle | null = null;
test.afterEach(async () => {
  await handle?.cleanup();
  handle = null;
});

const manifest = (version: string) => JSON.stringify({
  schema: 1, id: 'my.fix', version, author: { name: 'me', signature: null }, hackmac: { min: '0.1.0' },
  name: '고장 난 앱', icon: '🔧', tagline: '{hotkey:go} 누르면', usage: ['{hotkey:go}'],
  triggers: [{ kind: 'hotkey', script: 'scripts/x.sh', key: 'go', name: '실행', description: '실행한다' }],
  capabilities: {}, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false }, settings: [], secrets: [], references: [],
});

const pkg = (dir: string, version: string, script: string) => {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), manifest(version));
  writeFileSync(join(dir, 'scripts', 'x.sh'), script);
};

/** 설치된 v1(깨진 앱) + 보관 대기 중인 v2(팀이 고친 것) */
const seed = (userData: string) => {
  pkg(join(userData, 'apps', 'my.fix', 'v1'), '1', '#!/bin/zsh\nnonexistent-tool\n');
  writeFileSync(join(userData, 'apps', 'my.fix', 'current'), '1\n');
  const fixDir = join(userData, 'maintenance', 'pending', 'fix-seed');
  pkg(join(fixDir, 'app'), '2', '#!/bin/zsh\necho ok\n');
  writeFileSync(join(fixDir, 'meta.json'), JSON.stringify({
    id: 'fix-seed', appId: 'my.fix', appName: '고장 난 앱', cause: 'code', problem: '앱의 스크립트가 중간에 멈췄어요',
    summary: '없는 명령을 쓰던 부분을 고쳤어요.', createdAt: '2026-11-06T10:00:00.000Z', announced: true, dir: join(fixDir, 'app'),
  }));
};

const openDetail = async () => {
  handle = await launchApp({ claude: 'in', seed });
  const page = handle.page;
  const card = page.locator('.service-card', { hasText: '고장 난 앱' });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await card.click(); // 꺼진 카드를 누르면 켜진다
  await expect(card.locator('.status-pill-active')).toBeVisible({ timeout: 10_000 });
  await card.click(); // 켜진 카드를 누르면 상세
  await expect(page.locator('.detail-page h1')).toHaveText('고장 난 앱');
  return page;
};

test('앱 상세에 대기 중인 수정본이 보이고, [적용]하면 새 버전이 되고 앱은 계속 켜져 있다', async () => {
  const page = await openDetail();
  const fix = page.locator('[data-fix="fix-seed"]');
  await expect(fix).toContainText('문제를 고친 버전이 있어요');
  await expect(fix).toContainText('앱의 스크립트가 중간에 멈췄어요');
  await expect(fix).toContainText('고친 것: 없는 명령을 쓰던 부분을 고쳤어요.');
  await expect(page.locator('.toggle-button.is-active', { hasText: '켜짐' })).toBeVisible();

  await page.locator('[data-apply-fix="fix-seed"]').click();
  await expect(page.locator('.maint-msg')).toHaveText('고친 버전을 적용했어요.', { timeout: 15_000 });
  await expect(fix).toHaveCount(0);
  await expect(page.locator('.toggle-button.is-active', { hasText: '켜짐' })).toBeVisible(); // 적용하면서 다시 켜도 켜져 있다
  await page.locator('.build-log summary', { hasText: '유지보수 기록' }).click();
  await expect(page.locator('.maint-section')).toContainText('수정을 적용했어요');

  const app = join(handle!.userData, 'apps', 'my.fix');
  expect(readFileSync(join(app, 'current'), 'utf8').trim()).toBe('2');
  expect(readFileSync(join(app, 'v2', 'scripts', 'x.sh'), 'utf8')).toContain('echo ok');
  expect(readFileSync(join(app, 'v1', 'scripts', 'x.sh'), 'utf8')).toContain('nonexistent-tool'); // 옛 버전은 남아 되돌릴 수 있다
  expect(existsSync(join(handle!.userData, 'maintenance', 'pending', 'fix-seed'))).toBe(false);
});

test('[쓰지 않기]는 수정본을 버리고 현재 버전은 그대로다', async () => {
  const page = await openDetail();
  await page.locator('[data-dismiss-fix="fix-seed"]').click();
  await expect(page.locator('[data-fix="fix-seed"]')).toHaveCount(0);
  expect(readFileSync(join(handle!.userData, 'apps', 'my.fix', 'current'), 'utf8').trim()).toBe('1');
  expect(existsSync(join(handle!.userData, 'maintenance', 'pending', 'fix-seed'))).toBe(false);
});

test('"확인 없이 바로 적용" 설정은 켜고 끌 수 있고 저장된다', async () => {
  const page = await openDetail();
  const box = page.locator('[data-auto-apply]');
  await expect(box).not.toBeChecked();
  await box.check();
  await expect(box).toBeChecked();
  await expect.poll(() => JSON.parse(readFileSync(join(handle!.userData, 'settings.json'), 'utf8')).autoApplyFixes).toBe(true);
  await box.uncheck();
  await expect.poll(() => JSON.parse(readFileSync(join(handle!.userData, 'settings.json'), 'utf8')).autoApplyFixes).toBe(false);
});
