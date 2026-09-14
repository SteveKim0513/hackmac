import { expect, test } from '@playwright/test';
import { callPopupCli, launchApp, type AppHandle } from './helpers';

// 서비스 스크립트가 `$HACKMAC_POPUP`으로 실제로 띄우는 팝업을 끝까지
// 검증한다: CLI 호출 → electron/popupServer.ts → electron/popupWindow.ts가
// 띄우는 실제 BrowserWindow → src/popup/PopupApp.tsx 렌더링 → Playwright가
// 그 창을 클릭/타이핑 → 그 결과가 다시 CLI의 stdout/종료 코드로 돌아오는지.
// mock 소켓 서버가 아니라 실제 파이프라인 전체를 태운다.
//
// 팝업을 "닫히게" 만드는 마지막 키 입력은 `keyboard.press()`가 아니라
// `keyboard.down()`을 쓴다 — `.press()`는 keydown과 keyup을 순서대로 별도
// CDP 호출 두 번으로 보내는데, 우리 팝업은 keydown 한 번에 IPC로 응답을
// 보내고 창을 곧장 닫아버린다. keydown 처리 중에 창이 사라지면 뒤이은 keyup
// 호출이 "Target page ... has been closed"로 실패한다 — 우리 팝업 로직의
// 버그가 아니라(keydown만으로 완결됨을 아래 테스트들이 증명한다),
// press()가 필요로 하는 keyup을 받아줄 대상이 없어져서 생기는 하네스 쪽
// 경합이다. 창을 닫지 않는 중간 키(방향키 등)는 `.press()`를 그대로 쓴다.

let handle: AppHandle;

test.beforeEach(async () => {
  handle = await launchApp();
});

test.afterEach(async () => {
  await handle.cleanup();
});

test('select: 행을 한 번 클릭하면 그 즉시 선택된다 (기존 macOS 다이얼로그의 2클릭 문제 수정)', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'select',
    '--title', '업무 시작',
    '--prompt', '무엇을 시작할까요?',
    '--ok', '시작',
    '--cancel', '취소',
    '--',
    '프로젝트 제안서 초안 작성',
    '디자인 시스템 문서 정리',
    '주간 회고 노트 작성',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  await expect(popup.locator('.popup-title')).toHaveText('업무 시작');
  await expect(popup.locator('.popup-row')).toHaveCount(3);

  // 클릭 한 번 — OK 버튼을 따로 누르지 않는다.
  await popup.click('.popup-row >> text=디자인 시스템 문서 정리');

  const result = await cliPromise;
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('디자인 시스템 문서 정리');
});

test('select: 방향키 + Enter로도 고를 수 있다', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'select', '--title', 't', '--prompt', 'p', '--ok', 'o', '--cancel', 'c',
    '--', '항목1', '항목2', '항목3',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  await popup.keyboard.press('ArrowDown'); // 창을 닫지 않는 키 — press() 그대로
  await popup.keyboard.press('ArrowDown');
  await popup.keyboard.down('Enter'); // 마지막 키 — 창이 닫히므로 keydown만

  const result = await cliPromise;
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('항목3');
});

test('select: Esc를 누르면 취소로 처리된다 (종료 코드 1)', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'select', '--title', 't', '--prompt', 'p', '--ok', 'o', '--cancel', 'c', '--', '항목1',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  await popup.keyboard.down('Escape');

  const result = await cliPromise;
  expect(result.status).toBe(1);
});

test('prompt: 입력창에 자동 포커스되고, 입력한 값이 그대로 돌아온다', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'prompt', '--title', '업무 등록', '--prompt', '무엇을 할까요?', '--ok', '등록', '--cancel', '취소',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  const input = popup.locator('.popup-input');
  await expect(input).toBeFocused();
  await input.fill('새 리마인더 제목');
  await popup.keyboard.down('Enter');

  const result = await cliPromise;
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('새 리마인더 제목');
});

test('confirm: 취소 버튼이 있으면 취소를 선택할 수 있다', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'confirm', '--title', '업무 시작', '--prompt', '지금 3개 진행중이에요. 하나 더 시작할까요?', '--ok', '시작', '--cancel', '취소',
  ]);

  const popup = await app.waitForEvent('window');
  await expect(popup.locator('.popup-btn', { hasText: '취소' })).toBeVisible();
  await popup.click('.popup-btn:has-text("취소")');

  const result = await cliPromise;
  expect(result.status).toBe(1);
});

test('confirm: cancelLabel이 빈 문자열이면 취소 버튼이 아예 안 보인다 (정보 표시 전용)', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'confirm', '--title', '📊 업무 현황', '--prompt', '진행중 1개 · 완료 0개 · 대기 2개', '--ok', '확인', '--cancel', '',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  expect(await popup.locator('.popup-btn', { hasText: '취소' }).count()).toBe(0);
  await popup.click('.popup-btn:has-text("확인")');

  const result = await cliPromise;
  expect(result.status).toBe(0);
});

test('date: 날짜를 하나 클릭하면 그 즉시 YYYY-MM-DD로 선택된다', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'date', '--title', '업무 공유하기', '--prompt', '공유할 날짜를 선택하세요', '--ok', '선택', '--cancel', '취소', '--default', '2024-03-10',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  await expect(popup.locator('.popup-calendar-month')).toHaveText('2024년 3월');

  await popup.locator('.popup-calendar-grid button', { hasText: /^15$/ }).click();

  const result = await cliPromise;
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('2024-03-15');
});

test('date: 클릭 없이 선택 버튼을 누르면 기본값(--default)이 그대로 선택된다', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'date', '--title', '업무 공유하기', '--prompt', '공유할 날짜를 선택하세요', '--ok', '선택', '--cancel', '취소', '--default', '2024-03-10',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  await popup.click('.popup-btn.primary');

  const result = await cliPromise;
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('2024-03-10');
});

test('date: 다음 달로 넘긴 뒤 날짜를 클릭하면 그 달의 날짜로 선택된다', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'date', '--title', '업무 공유하기', '--prompt', '공유할 날짜를 선택하세요', '--ok', '선택', '--cancel', '취소', '--default', '2024-03-10',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  await popup.click('.popup-calendar-navbtn[aria-label="다음 달"]');
  await expect(popup.locator('.popup-calendar-month')).toHaveText('2024년 4월');
  await popup.locator('.popup-calendar-grid button', { hasText: /^5$/ }).click();

  const result = await cliPromise;
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('2024-04-05');
});

test('date: Esc를 누르면 취소로 처리된다 (종료 코드 1)', async () => {
  const { app, userData } = handle;
  const cliPromise = callPopupCli(userData, [
    'date', '--title', '업무 공유하기', '--prompt', '공유할 날짜를 선택하세요', '--ok', '선택', '--cancel', '취소', '--default', '2024-03-10',
  ]);

  const popup = await app.waitForEvent('window');
  await popup.waitForSelector('.popup-card');
  await popup.keyboard.down('Escape');

  const result = await cliPromise;
  expect(result.status).toBe(1);
});
