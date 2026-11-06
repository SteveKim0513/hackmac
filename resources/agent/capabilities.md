# HackMac 능력 목록 (HackMac 2.x)

HackMac 앱은 **이 목록에 있는 것과 macOS 기본 도구만** 쓴다. 앱이 자기 네이티브 코드나 오픈소스 패키지를 가져오지 않는다. 목록에 없는 것이 꼭 필요하면 "HackMac에 아직 그 능력이 없음"이다.

## 앱이 도는 방식(트리거)

| 트리거 | 하는 일 |
|---|---|
| `hotkey` | 전역 단축키를 누르면 스크립트를 1회 실행. 키 조합은 앱이 고르지 않고 HackMac이 빈 자리(⌥1…⌥0, ⌥⇧1…)를 배정한다 |
| `resident` | 켜져 있는 동안 계속 도는 스크립트 하나(앱당 하나). `heartbeat`초 안에 표준 출력으로 `HACKMAC_HEARTBEAT` 한 줄을 보내야 한다. 죽으면 1초·5초·30초 뒤 다시 띄우고, 10분에 5번 죽으면 끈다 |
| `schedule` | `cron`(5칸, 분 시 일 월 요일) 또는 `every`(초)마다 1회 실행 |
| `login` | HackMac이 뜰 때 1회 실행 |

1회 실행은 5분 안에 끝나야 한다(사용자 응답 시간 포함).

## 능력

| 능력 | 버전 | 쓰는 법 |
|---|---|---|
| `popup` | 1 | `"$HACKMAC_POPUP" select\|prompt\|confirm\|date ...` — HackMac 디자인의 선택·입력·확인·날짜 창. 값은 표준 출력, 취소는 종료 코드 1 |

`popup` 사용법:

```
"$HACKMAC_POPUP" select  --title T --prompt P --ok O --cancel C [--default D] -- 항목1 항목2 ...
"$HACKMAC_POPUP" prompt  --title T --prompt P --ok O --cancel C [--default D]
"$HACKMAC_POPUP" confirm --title T --prompt P --ok O --cancel C      (취소 버튼 없이 알리기만: --cancel "")
"$HACKMAC_POPUP" date    --title T --prompt P --ok O --cancel C [--default YYYY-MM-DD] [-- 점찍을날짜 ...]
```

## 스크립트가 받는 환경

- `$HACKMAC_APP_DIR` 앱 패키지 폴더(읽기 전용으로 취급), `$HACKMAC_DATA_DIR` 앱 데이터 폴더(여기에만 쓴다)
- `$HACKMAC_SETTING_<KEY>` 사용자 설정값(선언의 `settings`), `$HACKMAC_SECRET_<KEY>` 비밀값(API 키 등, 선언의 `secrets`)
- 표준 출력·오류는 실행마다 로그 파일에 자동으로 남는다. 판단 지점마다 `echo`(AppleScript는 `log`)로 남긴다

## macOS 기본 도구 (믿을 수 있는 것)

`zsh`, `osascript`(AppleScript·JXA), `curl`, `plutil`, `defaults`, `sqlite3`, `sed`/`awk`/`grep`, `date`, `open`, `pbcopy`/`pbpaste`, `say`, `afplay`, `screencapture`, `mdfind`, `shortcuts`(단축어 앱 실행), `jq`는 **없다**(macOS 15부터 `/usr/bin/jq`가 있으나 그 전 버전엔 없다 — JSON은 `plutil -extract` 또는 JXA로 읽는다).

**쓸 수 없는 것**: `brew`, `npm`/`node`, `python3`(Xcode 도구가 없으면 설치 창이 뜬다), `git`, `pip`, `ruby` 등. `sudo`도 안 된다.

## 할 수 있는 일의 예

- 알림 배너: `osascript -e 'display notification "본문" with title "제목"'`(대화창이 아니라 배너라 popup 규칙 대상이 아님)
- Apple 앱 자동화: 미리알림·캘린더·메모·Finder·Music·Safari 등 `tell application "…"`(처음 쓸 때 macOS 권한 승인 창이 뜬다 — 선언의 `permissions.automation`에 적는다)
- 웹에서 데이터 받기: `curl`(선언의 `permissions.network`에 주소를 적는다)
- 파일·클립보드·화면 캡처·소리·말하기·단축어 실행
- 키 입력 흉내: `tell application "System Events" to keystroke …` — 손쉬운 사용 권한이 필요하다(`permissions.accessibility: true`, `automation`에 "System Events")

## 아직 없는 것(지금은 만들 수 없다)

- 메뉴바에 앱 자신의 아이콘·글자를 띄우기(메뉴바 표시 능력 없음)
- 화면 위에 떠 있는 사용자 정의 창·위젯(팝업 4종 말고는 없음)
- 마우스 클릭 흉내, 다른 앱 화면 읽기
- 이미지 인식·OCR, PDF 내용 읽기, 앱 실행 중의 AI 호출
