# Claude Code Instructions

공통 개발 규칙(일하는 법·코드 규칙·팀 원칙·스킬)은 스튜디오 플러그인 팀 문서가 맡는다. 이 문서는 이 프로젝트의 값만 둔다.

## Start Here

- 이 프로젝트는 [mac-shortcut-manager](../mac-shortcut-manager)에서 엔진(전역 단축키 등록, 스크립트 실행)만 가져오고 UI 철학은 정반대다 — 사용자가 단축키를 만드는 도구가 아니라, 완성된 "서비스"를 켜고 끄는 제품이다. 배경은 [LOCKED-DOWN-APP-PROPOSAL.md](LOCKED-DOWN-APP-PROPOSAL.md), 구조는 [README.md](README.md) 참고.
- 새 서비스를 추가하기 전에 아래 "서비스 설계 원칙"을 읽는다.
- mac-shortcut-manager에서 만든 단축어를 이 앱의 서비스로 옮기는 작업(승격)은 `/promote-to-playbook` 스킬로 진행한다 — 관계와 이유는 [docs/playbook-graduation.md](docs/playbook-graduation.md) 참고.

## 서비스 설계 원칙

- **앱이 "서비스"가 되는 기준은 [docs/service-baseline.md](docs/service-baseline.md)(S1~S10)에 있다.** 게이트·감사·전문 담당 지시가 모두 이 문서를 따른다 — 기준을 바꾸면 `modules/build/gate.ts`(baseline 검사), `modules/build/audit.ts`(BASELINE_AUDIT), `resources/agent/roles/package-spec.md`를 같이 고친다.
- 서비스 하나 = `resources/services/<id>/manifest.json` (스토어 설명) + `scripts/*.sh` (단축키 하나당 스크립트 하나).
- 스크립트의 이름/설명은 `# @svc-name`, `# @svc-description` 헤더 주석에만 존재한다 — 별도 DB나 설정 파일을 만들지 않는다. 앱 시작 시 `modules/store/fromV1.ts`가 이 헤더를 읽어 v2 앱 패키지로 바꿔 보관소(`userData/apps/hackmac.<id>/`)에 넣는다. **`# @svc-hotkey`는 v2에서 무시된다** — 단축키는 앱이 고르지 않고 HackMac이 자리 풀(⌥1…⌥0, ⌥⇧1…)에서 배정한다(`modules/hotkey/slots.ts`, [docs/hackmac-v2-manifest.md](docs/hackmac-v2-manifest.md) 3.3.1). 카피에 키 조합을 직접 쓰지 말고 `(Alt+1)`처럼 쓴 것은 변환기가 `{hotkey:<key>}`로 바꾼다.
- **스크립트가 사용자와 상호작용해야 하는 순간(목록에서 고르기, 텍스트 입력받기, 확인받기)은 osascript의 `choose from list`/`display dialog`로 직접 그리지 않는다 — HackMac 앱에게 그려달라고 요청한다.** "완성된 서비스를 켜고 끄는 제품"이라는 이 앱의 정체성상, 사용자가 보는 화면은 팝업까지 포함해 전부 [docs/design.md](docs/design.md)에 정의된 하나의 디자인 시스템을 따라야 한다 — macOS 기본 다이얼로그의 각지고 이질적인 룩을 그대로 노출하면 안 된다. 방법: 스크립트는 `"$HACKMAC_POPUP" select|prompt|confirm ...`(`resources/bin/hackmac-popup`)를 호출해 표준입력으로 선택/입력값을 돌려받는다. 이 호출은 로컬 유닉스 소켓(`electron/popupServer.ts`)을 거쳐 이미 실행 중인 HackMac 앱이 Electron 팝업 창(`electron/popupWindow.ts` + `src/popup/`)을 띄우는 것으로 이어진다. **이건 서비스를 "감싸는" 새로운 레이어가 아니라, 원래 osascript가 하던 여러 역할 중 딱 하나(다이얼로그 렌더링)만 앱에 위임하는 것이다** — Reminders 조회/수정, 시간 계산, 알림 표시 등 나머지 업무 로직은 여전히 스크립트(및 그 안의 osascript) 소유다. 부수 효과로, 여러 다이얼로그를 순서대로 띄우는 스크립트에서 매번 `activate`를 재호출해야 했던 AppleScript 포커스 문제(아래 "환경에서 겪은 것들" 참고)가 사라진다 — 포커스는 이제 Electron 창의 `show()/focus()`가 책임진다. 정보 표시만 하고 상호작용이 없는 `display notification`은 그대로 둔다(팝업이 아니라 배너라 이 규칙 대상이 아님).
- **`manifest.json`의 카피(`tagline`/`whatItIs`/`differentiators`/`strengths`/`usage`)를 새로 쓰거나 고칠 때는 매번 `/copywriting` 스킬을 호출하고, [docs/service-copy-guide.md](docs/service-copy-guide.md)를 읽은 뒤 쓴다.** 이 페이지는 랜딩페이지가 아니라 이미 설치한 사용자가 효용을 체감하고 실제로 쓸 수 있게 돕는 페이지라, `/copywriting`의 일반 마케팅 카피 기준을 `docs/service-copy-guide.md`가 이 프로덕트에 맞게 어떻게 바꿔 쓰는지까지 함께 봐야 한다 — 스킬만 보고 일반 랜딩페이지 공식(소셜 프루프, CTA 버튼 카피, 가격 섹션 등)을 그대로 적용하지 않는다.
- 번들 서비스는 보관소에 **이미 설치돼 있으면 다시 넣지 않는다**(`Platform.installBundledV1`). 개발 중 스크립트/매니페스트를 고쳤다면 `npm run dev` 재시작만으로는 반영되지 않는다 — `userData/apps/hackmac.<id>/`를 지우고 재시작한다. (번들 버전이 올라가면 새 버전으로 넣는 처리는 아직 없다.)
- **Reminders/Calendar/Notes 같은 Apple 기본 앱에서 제목/완료 여부/마감일/메모 같은 기본 필드를 넘어서는 데이터(첨부파일, 리치 링크, 폴더 구조 등)를 읽는 스크립트를 새로 만들 때는, 코드를 짜기 전에 [docs/apple-app-data-access-guide.md](docs/apple-app-data-access-guide.md)의 사전 진단 체크리스트부터 실행한다.** 공개 API가 애초에 노출하지 않는 데이터를 공개 API로 찾으려다 데이터 형식 오해 → API 한계 → 성능 → 툴체인 → 권한 문제를 층층이 다시 겪는 실수를 반복하지 않기 위함이다.
- **스크립트는 판단 지점마다(입력값 확인, 조회 결과 개수, 분기 선택 등) stdout/stderr(AppleScript면 `log "..."`)로 남긴다.** `modules/runner/runner.ts`가 모든 실행의 stdout/stderr를 그 실행 전용 로그 파일(`~/Library/Logs/HackMac/<앱id>/<날짜>/*.log`, `modules/runner/execlog.ts` 참고)에 자동으로 담아주므로, 스크립트 작성자가 따로 로그 파일을 만들 필요는 없고 이 습관만 지키면 된다 — 안 하면 실패했을 때 "무엇을 하다가" 실패했는지 실행 로그만 봐선 알 수 없다.

## Required Commands

```bash
npm install
npm run dev          # Electron + Vite 개발 서버
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + 렌더러/일렉트론 번들
npm run test:e2e     # build + Playwright E2E (화면 없이 실제 Electron을 띄워 스토어·팝업을 실제로 클릭/타이핑해 검증 — docs/e2e.md)
npm run dist          # test:e2e 통과가 전제 + Developer ID 서명 + 공증(notarize) .dmg/.zip 빌드 (release/, 퍼블리시 안 함)
npm run release       # test:e2e 통과가 전제 + dist와 동일 + GitHub Releases에 발행까지 (draft로 올라가므로 draft=false 수동 처리 필요)
```

- 완료 주장 전 최소 `npm run typecheck` (UI·electron 변경 시 `npm run build`까지) 실행.
- UI/Electron 변경은 `npm run dev`로 실제 창을 띄워 확인한다.
- **팝업(선택/입력/확인) 로직을 바꿨다면 `npm run test:e2e`로도 확인한다.** `npm run dev`로 실제 단축키를 눌러 확인하는 것과 별개로, 이 테스트는 사람 없이도 서비스 스크립트가 실제로 부르는 CLI(`resources/bin/hackmac-popup`)로 요청을 보내고 뜬 창을 직접 클릭/타이핑해 검증한다 — `npm run dist`/`release`가 이 통과를 전제로 하므로, 팝업이 깨진 채로는 애초에 배포 커맨드가 끝까지 진행되지 않는다. 자세한 구조와 함정(`app.getAppPath()`, `keyboard.press()` vs `.down()`)은 [docs/e2e.md](docs/e2e.md) 참고 — [mind-map-mac](../mind-map)의 `make pre-release`와 같은 발상이다.
- **E2E는 진짜 claude/codex 대신 가짜 CLI를 쓴다.** `e2e/helpers.ts`의 `launchApp({ claude, codex })`가 `modules/conversation/fixtures/fake-*.mjs`를 감싼 스크립트 폴더를 만들고 `HACKMAC_CLI_DIRS`로 넘긴다(`electron/studioHost.ts`는 이 변수가 있으면 그 폴더에서만 CLI를 찾는다). 기본은 Claude만 로그인 — 그래서 기존 스토어 시험은 첫 실행 화면 없이 홈으로 간다. 진짜 엔진으로 실제 창에서 대화해 보려면 `HACKMAC_REAL_ENGINES=1 npx playwright test e2e/real.spec.ts`(구독 사용량을 조금 쓴다).
- 패키지 매니저는 npm만 쓴다.
- `npm run dev`/`dist`는 각각 `predev`/`predist` 훅으로 `kill:dev`(이 프로젝트의 `node_modules/electron/dist/Electron.app` 경로로 실행 중인 dev 프로세스를 찾아 종료)를 자동 실행한다.

## 배포 서명 · 공증 (다른 Mac에 설치할 때 Gatekeeper 경고 없애기)

미서명 앱을 다른 Mac에서 열면(특히 macOS Sequoia 이후) 첫 실행 팝업에 "그래도 열기" 버튼 자체가 없고, 시스템 설정 → 개인정보 보호 및 보안까지 들어가야 열기 버튼이 나타난다 — 안내 없이는 사용자가 찾기 어렵다. 이 프로젝트는 Developer ID Application 인증서(`Imagine Furtures Co.,Ltd.`, Team ID `493CJL5C9A`)가 있으므로, 서명 + 공증을 붙이면 이 경고 자체가 사라진다(정상적인 "열기" 다이얼로그로 바뀜).

- `package.json`의 `build.mac.hardenedRuntime: true`는 이미 켜져 있고, `identity`는 지정하지 않아 electron-builder가 Keychain에서 Developer ID Application 인증서를 자동으로 찾는다 (`security find-identity -v -p codesigning`으로 확인 가능). electron-builder(`@electron/notarize`, `node_modules/app-builder-lib/out/macPackager.js`의 `notarizeIfProvided`)는 공증 자격증명을 3가지 방식 중 하나로 받는데, 이 프로젝트는 **Keychain 프로필** 방식을 쓴다 — mac-shortcut-manager 계열 다른 프로젝트(mind-map-mac)와 동일한 관례. 평문 비밀번호를 담은 파일(`.env` 등)을 디스크에 두지 않기 위해서다.
- 최초 1회만 등록하면 된다 (이미 이 Mac에는 등록돼 있음):
  ```bash
  xcrun notarytool store-credentials "hackmac-notary" \
    --apple-id "<Apple Developer 계정 이메일>" \
    --team-id "493CJL5C9A" \
    --password "<appleid.apple.com → 로그인 및 보안 → 앱 암호에서 발급>"
  ```
  비밀번호는 macOS Keychain에 암호화되어 저장되고, 이후로는 `hackmac-notary`라는 프로필 이름만 쓴다.
- `npm run dist`(`package.json`의 `dist` 스크립트)는 `APPLE_KEYCHAIN_PROFILE=hackmac-notary`를 자동으로 넘기도록 이미 박혀 있어서, 매번 직접 export할 필요 없이 `npm run dist` 한 줄이면 서명 → 공증 제출 → 대기 → 스테이플까지 끝난다.
- 다른 Mac에서 이 레포로 처음 배포 빌드를 하는 경우: 위 `store-credentials` 명령을 그 Mac에서 한 번 실행해 프로필을 새로 등록해야 한다 (Keychain은 Mac마다 별도).
- 빌드 후 검증:
  - `spctl -a -vv release/mac-arm64/HackMac.app` → `accepted`, `source=Notarized Developer ID`가 나오면 성공.
  - `xcrun stapler validate release/mac-arm64/HackMac.app` → `The validate action worked!`이면 오프라인에서도(공증 서버 접속 없이) Gatekeeper가 통과한다.
- 환경변수가 없으면 electron-builder가 서명은 하되 공증은 건너뛴다(에러 없이 조용히 스킵) — 서명만 된 앱도 미서명보다는 낫지만 최초 실행 시 경고는 여전히 뜬다. 다른 Mac 배포 전에는 반드시 위 검증 커맨드로 공증이 실제로 됐는지 확인할 것.

## 자동 업데이트 (GitHub Releases)

`electron/updater.ts`가 `electron-updater`로 앱 시작 10초 후 한 번, 이후 4시간마다 배경에서 새 버전을 확인한다(패키지 빌드에서만 — `npm run dev`는 비활성). 새 버전을 받으면 "지금 재시동 / 나중에" 네이티브 다이얼로그를 띄우고, "나중에"는 다음 종료 시 자동 적용된다. mind-map-mac과 같은 구조.

- 배포처는 `github.com/SteveKim0513/hackmac` (Public repo — mind-map-mac과 같은 계정 별칭 `git@github.com-stevekim:...` 사용). Public이라 업데이트 확인/다운로드엔 토큰이 필요 없다(Private로 하면 토큰을 앱에 내장해야 해서 배포되는 바이너리마다 개인 계정 토큰이 노출되므로 일부러 Public으로 함).
- `npm run dist`는 여전히 `--publish never`라 실제 릴리스는 안 올라간다 — 로컬에서 서명 확인만 하고 싶을 때 씀.
- **실제로 새 버전을 배포하려면 `package.json`의 `version`을 올리고 `npm run release`를 실행한다.** `GH_TOKEN=$(gh auth token --user SteveKim0513)`을 자동으로 넘겨서 서명 → 공증 → GitHub Release(태그 `v<version>`) 생성 → 자산(dmg/zip/blockmap/`latest-mac.yml`) 업로드까지 한 번에 끝낸다.
- **`npm run release`(electron-builder `--publish always`)는 커밋을 `git push`하지 않는다 — GitHub Releases API로 릴리스/태그만 만든다.** 로컬 커밋을 push하지 않은 채로 이 명령을 반복하면, 매번 만들어지는 태그가 실제로는 origin의 정체된 옛 커밋을 가리키게 된다(빌드 자체는 로컬 워킹트리 기준이라 바이너리는 맞지만, GitHub 태그가 가리키는 소스 커밋은 틀어짐) — 실제로 v0.2.0~v0.2.3 태그가 전부 v0.1.2 커밋을 가리키고 있는 걸 발견했다(로컬 main이 origin보다 6커밋 앞서 있었던 게 원인). **버전을 올리는 커밋을 만들었으면 `npm run release` 전에 반드시 `git push`부터 한다.**
- **electron-builder는 릴리스를 기본적으로 draft(비공개 초안)로 만든다.** `electron-updater`는 draft를 못 찾으므로, `npm run release` 후 반드시 draft를 풀어야 실제 사용자에게 업데이트가 보인다:
  ```bash
  GH_TOKEN=$(gh auth token --user SteveKim0513) gh release edit v<version> --repo SteveKim0513/hackmac --draft=false
  ```
- SteveKim0513 계정으로 릴리스를 올리려면 그 Mac에 `gh auth login`으로 SteveKim0513 계정이 등록돼 있어야 한다(`gh auth token --user SteveKim0513`이 토큰을 돌려줄 수 있어야 함) — 다른 Mac에서 처음 배포할 땐 이것부터 확인.

## Architecture

```
electron/main.ts         ─ 창 생성, 트레이, IPC 핸들러, --role 판단, 상주 agent(SMAppService) 등록, 종료 시 실행기 정리
electron/platformHost.ts ─ 플랫폼 모듈에 Electron 것(globalShortcut, 팝업 env, 알림)을 주입, v1 설정 이전, AppView → ServiceMeta
electron/exec-log.ts     ─ 로그 폴더 위치와 오래된 실행 로그 정리
electron/updater.ts      ─ GitHub Releases 기반 자동 업데이트 (electron-updater)
modules/platform/        ─ 보관소·자리·실행기·원장·설정을 잇는 오케스트레이터 (Electron 없이 vitest로 시험)
modules/store/           ─ 앱 보관소(버전 폴더·current) + v1 서비스 → v2 패키지 변환기
modules/hotkey/slots.ts  ─ 단축키 자리 풀과 배정
modules/runner/          ─ 1회 실행·상주 감독·cron·실행 로그
modules/ledger/          ─ 추가 전용 JSONL 사건 원장
modules/settings/        ─ v2 settings.json(안전 쓰기, 깨진 파일 사본)
modules/account/         ─ claude/codex CLI 찾기·로그인 상태·로그인 흐름·엔진 고르기, 같은 회사 계정 목록(accounts.ts, 최대 3개·수동 전환)과 세션 복사(session.ts) (토큰은 안 만짐, API 키 env는 늘 뗌)
modules/conversation/    ─ 대화 엔진 공통 인터페이스 + Claude(stream-json)·Codex(app-server) 어댑터. 실제 CLI 시험은 HACKMAC_REAL_ENGINES=1
modules/thread/          ─ 스레드 보관(스레드 하나 = 앱 하나, userData/threads/<id>/: thread.json·messages.jsonl·work/)
modules/studio/chat.ts   ─ 스레드마다 엔진을 이어 열고 대화를 쌓는다. 스레드는 처음 회사를 지킨다
modules/memory/          ─ 앱 기억(memory.json): 대화를 구조화해 압축(엔진)·칸마다 따져 읽기·새 세션용 글, compactor(30분 뒤·바뀐 게 있을 때만 한 번에 하나)
modules/recipe/          ─ 레시피: 기억에서 코드가 뽑는다(환경은 빈칸, 개인 값·코드 제거, 참고 블록)·붙여넣은 레시피 파싱·받는 쪽 지시문
modules/maintain/        ─ 자가 유지보수: classify(코드가 먼저 원인 분류)·policy(하루 3번·밤·개발 중 보류)·maintainer(감시자: 안내/팀 호출/보관/적용)·team(격리 폴더에서 수정본, 검증 게이트 통과해야 보관)
electron/maintainHost.ts ─ 유지보수의 팝업·알림·IPC·1분 타이머. 앱 상세의 "유지보수" 구역과 짝
modules/bundle/          ─ .hackapp 꾸러미: 묶기(pack)·검증하며 풀기(unpack)·선언 요약(preview, 실행 안 함). Platform.exportApp/previewBundle/installBundle이 쓴다
modules/prepare/         ─ CLI 자동 설치(공식 설치 스크립트, 설치기에 기존 PATH를 안 보여 줌)
modules/build/           ─ 제작: gate(검증 게이트, 서비스 기준 S2·S5·S7 포함)·progress(진행 기록)·inbox(에이전트↔HackMac 파일 통로)·evaluate(별도 역할 평가)·builder(스레드별 제작, handoff)·agent(지시·격리 설정)
                           pipeline(전문 담당 오케스트레이터: 채점→설계→실험→개발→카피→시험→[게이트→감사]→보완 최대 3번→설치)·roles(역할 정의·프롬프트)·rubric(일하기 전 채점표)·audit(다른 회사 엔진의 목표 달성 감사)·experiment(후보를 격리된 곳에서 돌려 재기)
modules/knowledge/       ─ 배운 것 쌓기(lessons.jsonl): 보완으로 고친 함정·끝내 막힌 방법·사용자 취향. 모든 담당 프롬프트와 요구 정리 담당 지시에 붙는다
modules/settings/values.ts ─ 앱 설정값 검증·기본값·time→cron(설정 화면·스크립트 env·스케줄이 같은 규칙)
modules/secrets/         ─ 앱 비밀값(safeStorage 암호화, 못 쓰면 저장 거절)
resources/agent/         ─ 요구 정리 담당 지시(builder.md: 질문으로 기준 캐내기 → req --accept → handoff)·유지보수 팀(maintainer.md)·능력 목록(capabilities.md)·roles/(전문 담당 지시와 공통 package-spec.md). 능력을 추가하면 capabilities.md도 고친다
resources/bin/hackmac-build ─ 에이전트가 부르는 제작 명령. hackmac-popup-stub은 게이트가 시험을 돌릴 때 쓰는 가짜 팝업
electron/studioHost.ts   ─ 계정·스레드·채팅·제작 IPC. 지금은 실행 서버와 같은 메인 프로세스에서 돈다(--role=studio 분리는 이 파일만 옮기면 됨)
src/studio/              ─ 첫 실행 엔진 선택·로그인(Onboarding), 스레드 화면(왼쪽 단계 + 오른쪽 채팅)
shared/manifest.ts       ─ v2 앱 선언 타입과 검증
build/launchd/           ─ 상주 agent plist (electron-builder extraFiles로 Contents/Library/LaunchAgents에 들어감)
electron/preload.ts     ─ contextBridge로 window.playbook / window.hackmacPopup API 노출
electron/popupServer.ts ─ 스크립트 ↔ 팝업 창을 잇는 로컬 유닉스 소켓 서버
electron/popupWindow.ts ─ 선택/입력/확인 팝업 BrowserWindow 생성·직렬화
resources/bin/           ─ 스크립트가 부르는 팝업 CLI(hackmac-popup, hackmac-popup-client.cjs)
shared/types.ts         ─ main ↔ renderer 공유 타입 (PopupRequest/PopupResult 포함)
src/App.tsx             ─ 스토어 그리드 / 서비스 상세 뷰 전환
src/store/, src/detail/ ─ 각 화면의 React 컴포넌트
src/popup/              ─ 팝업 창 전용 화면(PopupApp.tsx) — index.html을 `?mode=popup`으로 재사용
```

- `shared/`의 타입은 electron과 src 양쪽에서 import한다.
- 팝업 창은 별도 Vite 엔트리를 만들지 않고 메인 창과 같은 `index.html`/`main.tsx`를 재사용한다 — `src/main.tsx`가 `?mode=popup` 쿼리로 `App`과 `PopupApp` 중 무엇을 그릴지만 분기한다.

## 환경에서 겪은 것들 (mac-shortcut-manager에서 이어받은 교훈)

아래는 이 프로젝트가 아직 직접 겪지는 않았지만, 같은 엔진(Electron + globalShortcut + osascript)을 쓰는 mac-shortcut-manager에서 실제로 겪은 함정이다. 새 서비스를 만들거나 엔진을 건드릴 때 미리 알아두면 같은 삽질을 피할 수 있다.

- **`ELECTRON_RUN_AS_NODE=1`이 이 셸 환경에 기본으로 걸려 있다.** `electron .`을 직접 실행하면 Electron이 아니라 그냥 Node로 켜져서 앱이 안 뜬다. `npm run dev`(vite-plugin-electron이 자동으로 이 변수를 지움)는 문제없다.
- **Electron 렌더러는 `window.prompt()`를 지원하지 않는다** — 호출하면 다이얼로그 없이 바로 `null`. `alert()`/`confirm()`은 지원된다.
- **`globalShortcut.register()`는 같은 프로세스 안에서 두 번째 호출이 첫 번째를 조용히 덮어쓴다.** 실패를 반환하지 않으므로 반드시 등록을 한 곳에 모아 소유를 직접 추적해야 한다. v2에서는 `modules/hotkey/slots.ts`가 자리마다 주인을 하나만 두고, 실제 등록은 `Platform`만 한다 — `globalShortcut.register()`를 다른 곳에서 직접 부르지 말 것.
- **`display dialog`/`choose from list`는 그 다이얼로그가 뜨기 바로 직전에 `activate`를 호출해야 첫 클릭부터 먹는다.** 스크립트 맨 앞에서 한 번만 `activate`하면, 그 뒤에 다른 앱(Reminders 등)으로 Apple Event를 보내는 `tell application "..."` 블록이 하나라도 끼는 순간 포커스가 흐트러져서, 다음 다이얼로그의 첫 클릭이 선택이 아니라 포커스 뺏기로만 소비된다(mac-shortcut-manager commit `a43dac1`에서 실사용자 리포트로 발견됨). 이 프로젝트의 GTD 서비스 스크립트들은 이제 위 "서비스 설계 원칙"에 따라 사람과의 상호작용을 osascript 다이얼로그가 아니라 `$HACKMAC_POPUP`(Electron 창)로 그리므로 이 문제 자체를 겪지 않는다 — 포커스는 `electron/popupWindow.ts`의 `show()/focus()`가 책임진다. 이 교훈은 osascript `display dialog`/`choose from list`를 그대로 쓰는 다른 프로젝트(mac-shortcut-manager)나, 이 앱에서 앞으로 osascript 다이얼로그를 직접 쓸 일이 생겼을 때를 위해 남겨둔다.
- **osascript로 스크립트를 stdin(heredoc)으로 넘기면서 인자도 같이 줄 때는 `osascript - "$1" <<'EOF'`처럼 `-`를 반드시 붙여야 한다.** `-` 없이 쓰면 `"$1"`을 stdin 스크립트가 아니라 열어야 할 **파일 경로**로 오인해서 "No such file or directory" 에러가 나고, heredoc 내용은 조용히 무시된다.
- **Reminders/Notes/Calendar 앱을 `osascript`로 다루면 그 앱을 대상으로 한 최초의 Apple Event에서 macOS 자동화 권한 승인 창이 뜨고, 사용자가 직접 클릭할 때까지 그 `osascript` 프로세스가 무기한 블록된다.** 자동화로 이 창을 감지·클릭할 방법이 없다 — 터미널에서 검증할 때 백그라운드로 돌리고 타임아웃을 걸어야 한다. GTD 서비스 스크립트를 처음 실행하면 이 승인 창이 뜬다는 걸 사용법 안내에 포함해두는 게 좋다.
- **Reminders의 `whose` 필터는 종류에 따라 속도 차이가 크다.** `count of (every reminder whose completed is false)`처럼 개수만 세는 필터나, `name of every reminder of l` / `completed of every reminder of l`처럼 리스트 하나의 속성을 통째로 배열로 읽어오는 벌크 읽기(`04-status.sh`, `05-share.sh`가 이 패턴)는 몇 초 안에 끝나 안전하다. 반면 날짜 범위 whose 필터(Calendar에서 확인됨, `whose start date ≥ X`)는 20초 넘게 걸려 30초 타임아웃에 위험할 정도로 근접한다 — 이 패턴은 쓰지 않는다. per-item으로 순회하며 그때그때 속성을 하나씩 읽는 반복문도 항목 수가 많아지면 느려질 수 있으니, 개인 todo 리스트 규모(수십 개)를 벗어나는 사용 사례가 생기면 다시 점검할 것.
- **AppleScript에서 `every X whose ...`로 얻은 리스트를 순회하며 그 안의 항목을 이동/삭제하면 인덱스 기반 참조가 밀려서 엉뚱한 항목을 건드릴 수 있다.** `07-normalize.sh`의 전체 삭제 경로는 이 문제를 피하려고 먼저 리스트 이름만 전부 스냅샷으로 읽어두고, 매 반복마다 그 이름으로 살아있는 참조를 다시 조회해서 지운다. 비슷한 "리스트를 보면서 항목을 옮기거나 지우는" 스크립트를 새로 만들 때 같은 패턴을 쓸 것.
- **`osascript` heredoc 안에서 `choose from list`/`display dialog`를 Reminders 같은 다른 앱의 `tell application` 블록 안에 직접 쓰면 에러가 난다** (그 앱이 UI 다이얼로그 명령을 지원하지 않으므로). 서브루틴으로 빼서 `my 서브루틴이름(...)`으로 호출하면 `tell` 블록의 앱 스코프를 벗어나 최상위(현재 스크립트) 스코프에서 실행된다. 현재 GTD 스크립트들은 다이얼로그를 항상 `tell application "Reminders"` 블록 바깥에서 띄우도록 짜여 있어 이 문제를 안 겪지만, Reminders를 조회하며 그 자리에서 바로 골라야 하는 스크립트를 새로 만들 때는 이 우회가 필요할 수 있다.
- **`npm run dev`와 설치된 패키지 앱은 같은 `userData` 경로를 공유한다** (`requestSingleInstanceLock()` 때문에 패키지 앱이 떠 있으면 dev 인스턴스가 조용히 안 켜짐). dev로 확인하기 전에 패키지 앱을 먼저 종료할 것.
- **`npm run dev`로 띄운 인스턴스를 세션 종료 없이 방치하면, 나중에 실행한 패키지 앱이 아니라 그 오래된 dev 창이 대신 뜨는 것처럼 보일 수 있다.** UI 확인이 끝나면 dev 프로세스를 직접 종료하는 습관을 들일 것 (`predev`/`predist` 훅이 다음 실행 시점에 정리하지만, 그 사이엔 여전히 혼동을 일으킬 수 있다).
- **`System Events`의 `click at {x, y}`로 렌더러의 React `<button onClick>`을 누르는 건 이 환경에서 신뢰할 수 없다.** AX 쿼리는 클릭이 어떤 UI 엘리먼트에 맞았는지("group 1 of UI element ...")를 반환하지만, 실제로 Chromium의 클릭 이벤트가 발생하지 않아 `onClick` 핸들러가 실행되지 않는 경우를 실제로 겪었다(`services:activate` IPC가 안 불려서 `settings.json`이 그대로 비어있는 것으로 확인). mac-shortcut-manager CLAUDE.md의 "합성 키 입력이 globalShortcut까지 도달하지 않는다"는 기록과 같은 종류의 함정 — 클릭/키를 눌러야 확인되는 인터랙션은 자동화로 "안 된다"는 결과가 나와도 코드 버그의 증거가 아니다. 이런 경로는 코드 리뷰로 검증을 대신하거나, 사용자에게 직접 눌러봐 달라고 요청할 것.
- **전역 단축키가 실제로 스크립트를 실행하는지, Reminders 자동화 권한 승인 흐름이 실제로 뜨는지는 이 환경에서 자동화로 끝까지 검증할 수 없다** (위 클릭 문제 + mac-shortcut-manager CLAUDE.md에 기록된 Reminders 자동화 권한 승인 창 블로킹 문제가 겹친다). `npm run typecheck`/`npm run build`/스토어 그리드가 뜨는 것까지만 자동으로 확인하고, 켜기→단축키 실행→미리알림 반영까지 이어지는 전체 흐름은 사용자가 실제 키보드로 확인해야 한다.
- **Reminders/Calendar/Notes에서 첨부·리치 링크처럼 공개 API 밖의 데이터를 읽어야 하는 경우는 위 항목들과 원인이 다르다** — AppleScript/EventKit 자체의 문법·타이밍 문제가 아니라 그 데이터가 애초에 공개 API로 노출되지 않는 구조적 문제라, 로컬 SQLite 저장소를 읽기 전용으로 직접 열고 Full Disk Access 권한까지 필요할 수 있다. 이 경로를 타야 하는지 판단하는 진단 순서와 로깅 원칙은 [docs/apple-app-data-access-guide.md](docs/apple-app-data-access-guide.md)에 따로 정리해뒀다.
- **`nativeTheme.themeSource`를 바꿔도 렌더러의 `prefers-color-scheme` 미디어쿼리가 항상 실시간으로 따라오는 건 아니다.** 라이트/다크/시스템 선택 기능(`electron/main.ts`)을 만들며 실제로 겪었다 — 이 Mac의 실제 시스템 설정은 다크인데, `nativeTheme.shouldUseDarkColors`는 정확히 `true`를 돌려주는 반면 그 창의 `window.matchMedia('(prefers-color-scheme: dark)').matches`는 계속 `false`였다(Electron 33, Playwright `_electron`으로 띄운 창·오프스크린 여부와 무관하게 재현됨 — `show:false`로 새로 만든 완전히 기본 설정의 `BrowserWindow`에서도 동일). CSS `@media (prefers-color-scheme: dark)` 자체는 `page.emulateMedia()`로 강제하면 정상 동작해서, 문제는 우리 CSS가 아니라 "OS 신호 → Chromium 렌더러의 미디어쿼리" 구간이 안 붙는 것으로 좁혀졌다. 그래서 미디어쿼리에 기대지 않고, `nativeTheme.shouldUseDarkColors`를 IPC(`theme:getEffectiveDark` 조회 + `nativeTheme.on('updated')` 발생 시 `theme:changed` 브로드캐스트)로 렌더러에 직접 밀어주고, `src/main.tsx`가 그 값으로 `<html data-theme="dark">`를 세팅하며, `src/theme.css`는 미디어쿼리 대신 `:root[data-theme='dark']`를 쓴다 — 팝업 창도 같은 preload를 공유하므로 별다른 추가 배선 없이 이 방식으로 동기화된다. 다크모드가 관련된 새 화면을 만들 때 `prefers-color-scheme`를 직접 쓰고 싶어지면, 먼저 이 우회가 여전히 필요한지(Electron/OS 업데이트로 고쳐졌는지) 확인할 것.
