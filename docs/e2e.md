# E2E 테스트 — 배포 전 자동 검증

`npm run dist`/`npm run release`는 실제로 서명·배포하기 전에 `npm run test:e2e`를 먼저 통과해야 한다(둘 다 `test:e2e &&` 로 시작). 스토어 화면이 뜨는지, 그리고 무엇보다 서비스 스크립트가 띄우는 **팝업이 실제로 동작하는지**를 사람이 `npm run dev`로 하나하나 눌러보지 않아도 배포 커맨드 자체가 확인해준다 — [mind-map-mac](../mind-map)의 `make pre-release`(Playwright E2E로 게이트한 뒤에만 배포)와 같은 발상이다.

## 왜 필요했나

Electron 팝업(`electron/popupWindow.ts`)은 로컬 유닉스 소켓(`electron/popupServer.ts`)으로 셸 스크립트와 통신하는, 이 프로젝트에서 가장 복잡한 부분이다. 처음 만들었을 때 "소켓 프로토콜이 맞는지"는 모의 서버로 확인했지만, **실제 창이 뜨고, 클릭/키보드로 답하고, 그 값이 다시 스크립트로 돌아오는 전체 경로**는 검증하지 못한 채 넘어갈 뻔했다 — 정확히는 이 파이프라인 안에 진짜 버그가 하나 있었다(`allowHalfOpen` 누락으로 사람이 답할 때까지 기다리는 동안 소켓이 조용히 끊기는 문제, `electron/popupServer.ts` 커밋 참고). E2E가 아니었다면 실제 사용자가 겪고 나서야 알았을 문제다.

## 무엇을 확인하나

- `e2e/store.spec.ts` — 스토어 화면에 서비스 카드가 뜨는지, 서비스를 켜고 상세 페이지로 들어가는 흐름.
- `e2e/popup.spec.ts` — **서비스 스크립트가 실제로 부르는 것과 동일한 CLI**(`resources/bin/hackmac-popup`)로 select/prompt/confirm 팝업을 요청하고, 뜬 창을 Playwright로 직접 클릭/타이핑해서 답한 뒤, 그 값이 CLI의 stdout/종료 코드로 정확히 돌아오는지 확인한다. 모의 소켓 서버가 아니라 `electron/popupServer.ts` → `electron/popupWindow.ts` → `src/popup/PopupApp.tsx` 전체 경로를 실제로 태운다.
  - 원래 문제였던 "리스트 박스를 두 번 클릭해야 하는" 동작이 실제로 고쳐졌는지(한 번 클릭하면 그 즉시 선택됨)를 이 테스트가 직접 증명한다.

## 어떻게 돌아가나 — 화면 없이 진짜 Electron을 띄운다

`e2e/helpers.ts`의 `launchApp()`이 Playwright의 `_electron` 드라이버로 패키지된(`dist-electron/main.js`) HackMac을 직접 띄운다:

- `HACKMAC_USER_DATA=<임시 폴더>` — 실제 실행 중인 앱이나 다른 테스트 인스턴스와 설정 파일·popup 소켓·`requestSingleInstanceLock()`이 전혀 겹치지 않는다(`electron/main.ts`).
- `HACKMAC_E2E_QUIET=1` — 창을 화면 밖(-3000, -3000) 좌표에 띄우고 `showInactive()`로 보여준다. Playwright는 CDP로 창 내용을 직접 읽고 조작하므로 실제로 화면에 보이거나 OS 포커스를 가져갈 필요가 없다 — [mind-map-mac](../mind-map)의 `MINDMAP_E2E_QUIET`과 같은 패턴.

`npm run test:e2e`가 먼저 `npm run build`로 `dist-electron/main.js`를 만들어둔 뒤 `playwright test`를 돌린다 — 이 전제(빌드된 결과물이 있어야 함) 때문에 `test:e2e` 스크립트 자체에 빌드가 포함돼 있다.

## `Page.getAppPath()` 함정

Playwright에 Electron 앱을 띄울 때 `args: ['dist-electron/main.js']`처럼 **파일**을 직접 넘기면, Electron이 `app.getAppPath()`를 그 파일이 있는 디렉터리(`dist-electron/`)로 잡아버린다 — 거기엔 `package.json`이 없으니 `electron/paths.ts`의 `servicesDir()`이 `resources/services`를 못 찾아 서비스가 0개로 뜬다(실제로 이렇게 재현됨). 반드시 **프로젝트 루트 디렉터리**를 넘겨야 Electron이 그 안의 `package.json`의 `"main"`을 읽어 올바른 `app.getAppPath()`를 잡는다(`e2e/helpers.ts` 참고).

## `keyboard.press()`가 아니라 `keyboard.down()`을 써야 하는 경우

팝업을 **닫히게 만드는** 마지막 키 입력(Enter로 선택 확정, Esc로 취소)은 `page.keyboard.press(key)`가 아니라 `page.keyboard.down(key)`를 쓴다.

`.press()`는 keydown과 keyup을 순서대로 별도 CDP 호출 두 번으로 보낸다. 그런데 이 앱의 팝업은 keydown 한 번에 IPC로 응답을 보내고 창을 곧바로 닫아버리도록 만들어져 있다(`src/popup/PopupApp.tsx`) — keydown을 처리하는 사이에 창이 사라지면, 뒤이은 keyup 호출이 대상을 찾지 못해 `Target page, context or browser has been closed`로 실패한다. **팝업 로직 자체의 버그가 아니다** — keydown 하나만으로 선택이 완결된다는 걸 이 테스트들이 직접 증명하고, `.down()`만 써도 결과가 올바르게 돌아오는 것으로 확인했다. 창을 닫지 않는 중간 키(방향키로 하이라이트 이동 등)는 `.press()`를 그대로 써도 안전하다.

## 새 서비스/팝업 화면을 추가할 때

- 새 팝업 종류(`PopupRequest`에 kind 추가)를 만들면 `e2e/popup.spec.ts`에 최소 하나의 시나리오(정상 응답 + 취소)를 추가한다.
- 새 서비스를 추가해도 `e2e/store.spec.ts`는 손댈 필요 없다 — 서비스 이름을 하드코딩하지 않고 카드가 뜨는지, 켜고 상세로 들어가는 공통 흐름만 확인한다.
