import { defineConfig } from '@playwright/test';

// mind-map-mac과 같은 패턴 — Electron 앱을 Playwright의 `_electron` 드라이버로
// 직접 띄워 CDP로 조작한다. 각 테스트가 독립된 userData(임시 폴더)로 자체
// 인스턴스를 띄우므로(e2e/helpers.ts) 병렬 실행이 안전하다. 자세한 설명은
// docs/e2e.md 참고.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // 인스턴스마다 진짜 Electron 프로세스 하나가 뜬다 — 이 앱 규모(서비스
  // 하나, 테스트 몇 개)에서는 병렬로 얻을 속도 이득보다 동시에 여러
  // WindowServer 연결을 맺을 때의 불안정성이 더 크다고 판단해 직렬로 둔다.
  workers: 1,
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
  },
});
