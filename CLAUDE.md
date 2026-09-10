# Claude Code Instructions

## Start Here

- 작업 전 `git status --short` 확인.
- 이 프로젝트는 [mac-shortcut-manager](../mac-shortcut-manager)에서 엔진(전역 단축키 등록, 스크립트 실행)만 가져오고 UI 철학은 정반대다 — 사용자가 단축키를 만드는 도구가 아니라, 완성된 "서비스"를 켜고 끄는 제품이다. 배경은 [LOCKED-DOWN-APP-PROPOSAL.md](LOCKED-DOWN-APP-PROPOSAL.md), 구조는 [README.md](README.md) 참고.
- 새 서비스를 추가하기 전에 아래 "서비스 설계 원칙"을 읽는다.
- mac-shortcut-manager에서 만든 단축어를 이 앱의 서비스로 옮기는 작업(승격)은 `/promote-to-playbook` 스킬로 진행한다 — 관계와 이유는 [docs/playbook-graduation.md](docs/playbook-graduation.md) 참고.

## 서비스 설계 원칙

- 서비스 하나 = `resources/services/<id>/manifest.json` (스토어 설명) + `scripts/*.sh` (단축키 하나당 스크립트 하나).
- 스크립트의 이름/단축키/설명은 `# @svc-name`, `# @svc-hotkey`, `# @svc-description` 헤더 주석에만 존재한다 — 별도 DB나 설정 파일을 만들지 않는다 (`electron/parser.ts` 참고).
- **`manifest.json`의 카피(`tagline`/`whatItIs`/`differentiators`/`strengths`/`usage`)를 새로 쓰거나 고칠 때는 매번 `/copywriting` 스킬을 호출하고, [docs/service-copy-guide.md](docs/service-copy-guide.md)를 읽은 뒤 쓴다.** 이 페이지는 랜딩페이지가 아니라 이미 설치한 사용자가 효용을 체감하고 실제로 쓸 수 있게 돕는 페이지라, `/copywriting`의 일반 마케팅 카피 기준을 `docs/service-copy-guide.md`가 이 프로덕트에 맞게 어떻게 바꿔 쓰는지까지 함께 봐야 한다 — 스킬만 보고 일반 랜딩페이지 공식(소셜 프루프, CTA 버튼 카피, 가격 섹션 등)을 그대로 적용하지 않는다.
- 번들 리소스는 런타임에 바뀌지 않으므로 `electron/services.ts`는 앱 시작 시 1회만 스캔한다. 개발 중 스크립트/매니페스트를 고치면 `npm run dev`를 재시작해야 반영된다.
- **Reminders/Calendar/Notes 같은 Apple 기본 앱에서 제목/완료 여부/마감일/메모 같은 기본 필드를 넘어서는 데이터(첨부파일, 리치 링크, 폴더 구조 등)를 읽는 스크립트를 새로 만들 때는, 코드를 짜기 전에 [docs/apple-app-data-access-guide.md](docs/apple-app-data-access-guide.md)의 사전 진단 체크리스트부터 실행한다.** 공개 API가 애초에 노출하지 않는 데이터를 공개 API로 찾으려다 데이터 형식 오해 → API 한계 → 성능 → 툴체인 → 권한 문제를 층층이 다시 겪는 실수를 반복하지 않기 위함이다.

## Required Commands

```bash
npm install
npm run dev          # Electron + Vite 개발 서버
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + 렌더러/일렉트론 번들
npm run dist          # Developer ID 서명 + 공증(notarize) .dmg/.zip 빌드 (release/, 퍼블리시 안 함)
```

- 완료 주장 전 최소 `npm run typecheck` (UI·electron 변경 시 `npm run build`까지) 실행.
- UI/Electron 변경은 `npm run dev`로 실제 창을 띄워 확인한다.
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

## Architecture

```
electron/main.ts        ─ 창 생성, 트레이, IPC 핸들러
electron/services.ts    ─ resources/services 스캔 → 서비스 카탈로그, 켜기/끄기 상태 관리
electron/parser.ts      ─ .sh 헤더 주석(@svc-*) ↔ ServiceShortcut 변환
electron/runner.ts      ─ 스크립트 실행 (/bin/zsh)
electron/hotkeys.ts     ─ 전역 단축키 클레임 소유권 추적 (HotkeyRegistrar)
electron/settings.ts    ─ 켜진 서비스 id 목록 userData/settings.json 영속화
electron/preload.ts     ─ contextBridge로 window.playbook API 노출
shared/types.ts         ─ main ↔ renderer 공유 타입
src/App.tsx             ─ 스토어 그리드 / 서비스 상세 뷰 전환
src/store/, src/detail/ ─ 각 화면의 React 컴포넌트
```

- `shared/`의 타입은 electron과 src 양쪽에서 import한다.

## 환경에서 겪은 것들 (mac-shortcut-manager에서 이어받은 교훈)

아래는 이 프로젝트가 아직 직접 겪지는 않았지만, 같은 엔진(Electron + globalShortcut + osascript)을 쓰는 mac-shortcut-manager에서 실제로 겪은 함정이다. 새 서비스를 만들거나 엔진을 건드릴 때 미리 알아두면 같은 삽질을 피할 수 있다.

- **`ELECTRON_RUN_AS_NODE=1`이 이 셸 환경에 기본으로 걸려 있다.** `electron .`을 직접 실행하면 Electron이 아니라 그냥 Node로 켜져서 앱이 안 뜬다. `npm run dev`(vite-plugin-electron이 자동으로 이 변수를 지움)는 문제없다.
- **Electron 렌더러는 `window.prompt()`를 지원하지 않는다** — 호출하면 다이얼로그 없이 바로 `null`. `alert()`/`confirm()`은 지원된다.
- **`globalShortcut.register()`는 같은 프로세스 안에서 두 번째 호출이 첫 번째를 조용히 덮어쓴다.** 실패를 반환하지 않으므로 반드시 `electron/hotkeys.ts`의 `HotkeyRegistrar`처럼 등록을 한 곳에 모아 클레임 결과를 직접 추적해야 한다.
- **`display dialog`/`choose from list`는 그 다이얼로그가 뜨기 바로 직전에 `activate`를 호출해야 첫 클릭부터 먹는다.** 스크립트 맨 앞에서 한 번만 `activate`하면, 그 뒤에 다른 앱(Reminders 등)으로 Apple Event를 보내는 `tell application "..."` 블록이 하나라도 끼는 순간 포커스가 흐트러져서, 다음 다이얼로그의 첫 클릭이 선택이 아니라 포커스 뺏기로만 소비된다(mac-shortcut-manager commit `a43dac1`에서 실사용자 리포트로 발견됨). 그래서 GTD 서비스 스크립트들은 Reminders 조회 뒤에 다이얼로그를 띄울 때마다, 그리고 다이얼로그 여러 개를 순서대로 띄우는 스크립트(`02-start.sh`, `07-normalize.sh`)는 각 다이얼로그 직전마다 `activate`를 다시 호출한다.
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
