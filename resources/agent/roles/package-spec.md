# HackMac 앱 패키지 규칙 (개발·시험·카피 담당 공통)

## 패키지 (./app/)

```
app/
  manifest.json
  scripts/<이름>.sh      트리거가 실행하는 스크립트(zsh)
  checks/R<번호>-<이름>.sh  요구사항 R<번호>의 시험
```

manifest.json 예시(이 모양 그대로, 값만 바꾼다):

```json
{
  "schema": 1,
  "id": "my.today-agenda",
  "version": "1",
  "author": { "name": "me", "signature": null },
  "hackmac": { "min": "2.0.0" },
  "name": "오늘 일정",
  "icon": "📅",
  "tagline": "{hotkey:show} 한 번이면 오늘 일정이 보여요",
  "usage": ["{hotkey:show}를 누르면 오늘 남은 일정이 알림으로 떠요"],
  "triggers": [
    { "kind": "hotkey", "script": "scripts/show.sh", "key": "show", "name": "오늘 일정 보기", "description": "오늘 남은 일정을 알림으로 보여 줘요" }
  ],
  "capabilities": { "popup": ">=1" },
  "permissions": { "network": [], "automation": ["Calendar"], "accessibility": false, "fullDiskAccess": false },
  "settings": [ { "key": "calendar", "label": "볼 캘린더 이름", "type": "string", "default": "" } ],
  "secrets": [],
  "references": []
}
```

- `id`: `my.` + 영문 소문자·숫자·하이픈. 이미 설치한 앱을 고칠 때는 id를 그대로 두고 `version`을 1 올린다.
- 단축키 조합은 적지 않는다. 트리거에는 `key`(이름표)만 두고, 카피에는 `{hotkey:<key>}`라고 쓴다. HackMac이 자리를 배정한다. "Alt+1" 같은 조합을 카피에 쓰면 검증에서 막힌다.
- `capabilities`에는 쓰는 능력만. 팝업을 안 쓰면 `{}`.
- `permissions.automation`: 스크립트가 `tell application "X"`로 부르는 앱 이름 전부. `permissions.network`: `curl`로 접속하는 주소(호스트) 전부(`*.example.com` 가능).
- `settings`: 사용자마다 다를 수 있는 값은 전부 여기(시각·횟수·이름·주소·분량·켜기 끄기). 앱 상세의 설정 화면에 그대로 입력칸이 된다. 종류: string · number · boolean · choice(options 필수) · list(문자열 목록, 스크립트에는 JSON 배열 문자열) · time("HH:MM"). 스크립트는 `$HACKMAC_SETTING_<KEY 대문자, -는 _>`로 받는다. 기본값은 바로 써도 되는 값으로. 선언만 하고 안 읽는 설정, 읽는데 선언 안 한 설정은 검증에서 막힌다.
- `secrets`: API 키 등, `$HACKMAC_SECRET_<KEY>`. 사용자가 설정 화면에서 넣고 암호화돼 보관된다. 채팅에 적게 하지 않는다.
- 정해진 때 도는 일(schedule): 사용자가 때를 바꿀 수 있어야 하면 `cron`을 박지 말고 `"atSetting": "<time 설정 키>"`(매일 그 시각) 또는 `"everyMinutesSetting": "<number 설정 키>"`(그 분마다)를 쓴다. 예: `{ "kind": "schedule", "script": "scripts/notify.sh", "name": "아침 알림", "atSetting": "notify-at" }` + settings에 `{ "key": "notify-at", "label": "알림 시각", "type": "time", "default": "09:00" }`.
- `references`: 오픈소스를 참고했으면 저장소·커밋·경로·빌린 것·라이선스. 코드를 복사하거나 패키지를 동봉하지 않는다.

## 스크립트 규칙

- zsh와 macOS 기본 도구만. brew·npm·node·python3·git·sudo 금지. 사용자 홈 절대경로(/Users/…) 금지 — `$HOME`, `$HACKMAC_DATA_DIR`를 쓴다.
- 쓰는 파일은 `$HACKMAC_DATA_DIR` 안에만. `$HACKMAC_APP_DIR`는 읽기만.
- 사용자에게 고르기·입력·확인을 받을 때는 osascript `display dialog`·`choose from list`를 쓰지 않고 `"$HACKMAC_POPUP" select|prompt|confirm|date`를 쓴다. 정보만 보여 주는 배너는 `display notification` 그대로.
- 판단 지점마다(입력값, 조회 결과 개수, 고른 분기) `echo`로 남긴다(AppleScript 안에서는 `log`). 실행 로그에 자동으로 담긴다.
- 1회 실행은 5분 안에 끝낸다. 상주(resident)는 `heartbeat`초 안에 `echo HACKMAC_HEARTBEAT`를 계속 보낸다.
- 능력 목록에 없는 것을 흉내 내지 않는다(메뉴바 아이콘, 떠 있는 창 등).

## 시험 (checks/)

- 요구사항마다 `checks/R<번호>-<이름>.sh` 하나 이상. 성공이면 종료 0.
- 인터넷 접속이나 다른 앱 자동화가 있는 앱은 실패 경로 시험 `checks/E<번호>-<이름>.sh`가 하나 이상 있어야 한다(접속 실패·빈 결과·필수 설정이 빔).
- 검증 게이트는 시험을 **빈 가짜 홈**, **PATH=/usr/bin:/bin:/usr/sbin:/sbin**, `HACKMAC_CHECK=1`로 돌린다. `$HACKMAC_POPUP`은 창을 띄우지 않는 가짜다: select는 첫 항목(또는 `HACKMAC_STUB_SELECT`), prompt는 기본값(또는 `HACKMAC_STUB_PROMPT`), confirm은 확인(`HACKMAC_STUB_CONFIRM=cancel`이면 취소), `HACKMAC_STUB_CANCEL=1`이면 무엇이든 취소.
- **시험은 실제 앱(캘린더·미리알림 등)을 건드리지 않는다**(시험 스크립트에 osascript 금지 — 사용자 데이터를 지키려는 것). 그래서 앱 스크립트를 "데이터 가져오기(osascript)"와 "판단·가공(순수 zsh)"으로 나누고, 판단·가공 부분을 시험한다. 앱 스크립트는 `$HACKMAC_CHECK`가 1이면 실제 앱 대신 가짜 입력 파일(`$HACKMAC_DATA_DIR`에 시험이 만들어 둔 것)을 읽게 하는 식으로 짠다.
- 자동으로 확인할 수 없는 요구사항(실제 알림이 뜨는지, 특정 시각에 도는지)은 `req … --manual "이유"`로 표시한다. 그래도 그 요구사항의 판단 부분은 시험한다.

## macOS에서 겪은 함정

- `osascript - "$1" <<'EOF'`처럼 stdin 스크립트에 인자를 줄 때는 `-`를 꼭 붙인다.
- Reminders·Calendar·Notes를 처음 자동화하면 권한 승인 창이 뜨고 사용자가 누를 때까지 멈춘다. 5단계에서 사용자에게 부탁한다.
- Calendar의 날짜 범위 `whose start date ≥ …` 필터는 20초 넘게 걸린다. 쓰지 않는다. 리스트 속성을 통째로 읽는 벌크 읽기(`name of every reminder of l`)는 빠르다.
- `every X whose …`로 얻은 목록을 돌며 지우거나 옮기면 참조가 밀린다. 이름을 먼저 다 읽어 두고 매번 다시 찾는다.
- Apple 앱에서 제목·완료·마감일 같은 기본 필드를 넘는 데이터(첨부, 링크, 폴더 구조)를 읽어야 하면, 코드를 짜기 전에 아래 "Apple 앱 데이터 접근 진단" 문서의 체크리스트부터 따른다.

## 서비스 기준 (docs/service-baseline.md 요약)

앱은 함수가 아니라 서비스다. 설치한 사람이 안내를 받고, 자기 상황에 맞게 조정하고, 잘 될 때와 안 될 때 모두 무슨 일이 일어났는지 알 수 있어야 한다.

- S2 조정 가능: 사람마다 다를 값은 settings로. 코드에 박지 않는다.
- S3 첫 사용 준비: 필수 설정이 비었거나 권한이 없으면 "설정에서 ○○을 정해 주세요"처럼 알리고 끝낸다(조용히 실패하지 않는다).
- S4 결과가 보인다: 실행마다 결과가 보인다 — 잘 됨·할 일 없음·안 됨 셋 다(`display notification` 또는 `$HACKMAC_POPUP confirm --cancel ""`).
- S5 실패를 안다: curl·osascript 실패와 빈 결과를 잡아 쉬운 말로 알리고 echo로 남긴다.
- S6 다시 해도 안전: 두 번 눌러도 꼬이지 않게. 지우기 같은 되돌릴 수 없는 일은 먼저 confirm.
- S7 기록: 스크립트마다 판단 지점의 echo(AppleScript는 log).
- S8 설명: usage에 처음 쓸 때 뜨는 권한 창과 "앱 상세의 설정에서 바꿀 수 있어요"를 안내.
