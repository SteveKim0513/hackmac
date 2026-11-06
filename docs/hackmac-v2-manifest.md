# HackMac v2 앱 선언(manifest) 초안

[hackmac-v2-plan.md](hackmac-v2-plan.md) 9.2의 구체화. 앱 패키지 폴더 맨 위의 `manifest.json` 하나가 보관소·실행기·꾸러미·능력·제작 모듈 사이의 계약이다. 이 문서의 모든 항목은 **[초안]**이며, 스키마 파일(`shared/manifest.schema.json`)과 검증 코드가 생기면 그쪽이 원본이 된다.

색인: [1. 패키지 폴더](#1-패키지-폴더) · [2. 예시](#2-예시) · [3. 항목 설명](#3-항목-설명) · [4. 검증 규칙](#4-검증-규칙) · [5. v1과 달라지는 것](#5-v1과-달라지는-것) · [6. 정해야 할 것](#6-정해야-할-것)

## 1. 패키지 폴더

```
<app-id>/
  manifest.json        선언 (이 문서)
  scripts/             트리거가 가리키는 스크립트. zsh·osascript·node
  assets/              아이콘, 고정 데이터 (선택)
  README.md            사람이 읽는 설명 (선택, 레시피가 아님)
```

- 폴더 밖을 가리키는 경로는 없다. 모든 경로는 패키지 루트 기준 상대경로.
- 런타임에 쓰는 데이터·설정·비밀은 패키지에 두지 않는다. 실행기가 `$HACKMAC_DATA_DIR`로 준다.
- 버전 폴더(`v1/`, `v2/`)와 "현재 버전" 표시는 보관소가 패키지 바깥에서 관리한다. 패키지 자신은 자기 버전 번호만 안다.

## 2. 예시

```json
{
  "schema": 1,
  "id": "jiho.stock-ticker",
  "version": "3",
  "author": { "name": "jiho", "signature": null },
  "hackmac": { "min": "2.0.0" },

  "name": "주가 표시",
  "icon": "📈",
  "accentColor": "#30c48d",
  "tagline": "메뉴바에서 내 종목을 바로 봐요",
  "whatItIs": ["..."],
  "differentiators": ["..."],
  "strengths": ["..."],
  "usage": ["..."],

  "triggers": [
    { "kind": "resident", "script": "scripts/ticker.sh", "heartbeat": 60 },
    { "kind": "hotkey", "script": "scripts/add-symbol.sh", "key": "add-symbol", "name": "종목 추가", "description": "종목 코드를 입력하면 메뉴바 목록에 들어가요." },
    { "kind": "schedule", "script": "scripts/daily-summary.sh", "name": "장 마감 요약", "cron": "0 16 * * 1-5" }
  ],

  "capabilities": {
    "tray": ">=1",
    "popup": ">=1",
    "notify": ">=1",
    "ai": ">=1"
  },

  "permissions": {
    "network": ["finance.yahoo.com"],
    "automation": [],
    "accessibility": false,
    "fullDiskAccess": false
  },

  "settings": [
    { "key": "symbols", "label": "종목 코드", "type": "list", "default": [], "required": true },
    { "key": "refreshSec", "label": "갱신 간격(초)", "type": "number", "default": 60 }
  ],
  "secrets": [
    { "key": "apiKey", "label": "유료 시세 API 키 (없으면 15분 지연 시세)", "required": false }
  ],

  "references": [
    { "repo": "github.com/x/y", "commit": "a1b2c3", "path": "src/fetch.ts#withRetry", "borrowed": "429 응답일 때 지수 간격으로 3번 재요청", "license": "MIT" }
  ]
}
```

## 3. 항목 설명

### 3.1 정체

| 항목 | 뜻 | 규칙 |
|---|---|---|
| `schema` | 이 선언 형식의 판 | 정수. 읽는 쪽이 모르는 판이면 설치를 막는다 |
| `id` | 앱 식별자 | `<작성자>.<이름>`. 소문자·숫자·`-`·`.`. 같은 id 재설치 = 업그레이드, 데이터 유지 |
| `version` | 앱 버전 | 정수 문자열. 제작·유지보수 팀이 수정본을 낼 때마다 1씩 올린다. 의미 버전은 안 쓴다(사용자가 정하는 게 아니라서) |
| `author` | 작성자 | `name` 필수. `signature`는 예약(1차엔 `null`) |
| `hackmac.min` | 돌 수 있는 최소 HackMac 버전 | 능력 버전 요구와 별개로 플랫폼 자체의 하한 |

### 3.2 스토어 카피

v1 `ServiceManifest`와 같다: `name`, `icon`, `accentColor`, `tagline`, `whatItIs`, `differentiators`, `strengths`, `usage`. 쓰는 기준은 [service-copy-guide.md](service-copy-guide.md). **제작 모듈이 쓴다** — 사용자가 쓰지 않는다.

### 3.3 트리거

앱이 "언제 도는가". 하나 이상. `script`는 패키지 루트 기준 상대경로.

| kind | 뜻 | 추가 항목 |
|---|---|---|
| `hotkey` | 전역 단축키를 누르면 1회 실행 | `key`(앱 안에서 이 트리거를 가리키는 이름), `name`, `description`. **실제 키 조합은 적지 않는다** — 아래 3.3.1 |
| `resident` | 켜 있는 동안 계속 돈다 | `heartbeat`(초): 이 간격 안에 생존 신호가 없으면 실행기가 멈춘 것으로 본다 |
| `schedule` | 정해진 때 1회 실행 | `cron`(5칸) 또는 `every`(초) 중 하나, `name` |
| `login` | HackMac이 뜰 때 1회 실행 | `name` |
| `event` | 플랫폼 사건에 반응 | `on`: 능력이 내는 사건 이름(예: `wake`, `network.up`). 능력 모듈이 어떤 사건을 내는지는 능력 선언이 정한다 |

- `resident`는 앱당 하나.

#### 3.3.1 단축키 자리(slot) 배정 [결정]

앱은 키 조합을 고르지 않고 **자리를 요청**한다. HackMac이 켤 때 빈 자리를 배정한다.

- **자리 목록 [시작값]**: `Alt+1`~`Alt+0`, `Alt+Shift+1`~`Alt+Shift+0`의 20자리. 그중 2자리는 HackMac 몫으로 예약: "단축키 목록 보기"(치트시트 팝업), "HackMac 열기". 앱이 쓸 수 있는 자리는 18개. `Ctrl+Alt+숫자`로 바꿀 수 있다(아래 비용 참고).
- 배정은 사용자 데이터(`settings.json`)에 `<app-id>/<key> → 자리`로 저장한다. 패키지에는 없다. 레시피·앱 파일에 키가 박히지 않으므로 받는 사람은 자기 빈 자리를 받는다.
- 앱을 끄면 자리를 돌려준다. 다시 켜면 같은 자리가 비어 있으면 같은 자리, 아니면 새 자리.
- 자리가 다 차면 켜기 전에 "단축키 자리가 없어요 → 다른 앱의 자리 바꾸기" 화면을 보여 준다. 켜지지 않는다.
- 사용자는 설정에서 자리를 바꿀 수 있되 **목록 안에서만**. 임의 키 지정은 1차에 넣지 않는다.
- 배정된 키는 트레이 메뉴와 앱 상세에 늘 보이고, 치트시트 단축키로 전체 목록이 뜬다.
- 스토어 카피(`usage` 등)에 키를 직접 쓰지 않고 `{hotkey:<key>}` 자리표시를 넣는다. 화면이 배정된 키로 채운다. v1 GTD 카피의 "(Alt+1)"은 이 규칙으로 바꾼다.
- 등록은 v1 `HotkeyRegistrar`의 클레임 추적을 그대로 쓴다(`globalShortcut.register`가 조용히 덮어쓰는 문제 방지).

비용: 전역 단축키는 그 조합을 모든 앱에서 가로챈다. `Alt+숫자`는 macOS에서 특수문자(`¡™£`)를 입력하는 키라 그걸 쓰는 사용자는 입력이 막힌다(v1도 같은 비용). `Ctrl+Alt+숫자`가 더 안전할 수 있으나 실제로 눌러 보고 정한다 **[확인 필요]**.

### 3.4 능력 요구

`capabilities`: 능력 이름 → 버전 범위. 앱은 여기 적은 능력만 부를 수 있다(실행기가 환경변수·소켓을 그 능력에만 열어 준다).

| 능력 | 하는 일 | v1에서 오는 것 |
|---|---|---|
| `popup` | 선택·입력·확인·날짜 | `hackmac-popup`, `PopupRequest` |
| `tray` | 메뉴바에 글·아이콘·메뉴 | `trayStatus.ts` |
| `notify` | 배너 알림 | (osascript `display notification` 대체) |
| `hotkey` | — (트리거로만 씀, 능력으로 안 부름) | `hotkeys.ts` |
| `schedule` | — (트리거로만) | 없음 |
| `ai` | 로컬 엔진으로 글 생성·요약 ([plan 6.3](hackmac-v2-plan.md#63-앱-실행-중의-ai-결정)) | 없음 |
| `reminders`, `calendar`, `notes` | Apple 앱 읽기·쓰기 헬퍼(네이티브) | 없음(지금은 각 스크립트의 osascript) |
| `clipboard` | 읽기·쓰기 | `pbcopy` |

능력 목록 자체는 이 문서의 범위가 아니다. 각 능력 모듈이 자기 선언에서 이름·버전·내는 사건·요구 권한을 밝힌다.

### 3.5 권한

앱이 선언한 능력과 스크립트가 쓰는 macOS 권한. **설치 때 사용자에게 요약해 보여 주는 것이 목적**이고, OS가 앱 단위로 막아 주지는 않는다([plan 9.5](hackmac-v2-plan.md#95-받은-파일의-신뢰)).

| 항목 | 뜻 |
|---|---|
| `network` | 접속하는 호스트 목록. `["*"]`는 "아무 데나"이고 설치 화면에 경고로 보인다 |
| `automation` | osascript로 제어하는 앱 이름 목록(`"Reminders"` 등). 능력 헬퍼를 쓰면 능력 선언이 대신 밝힌다 |
| `accessibility` | 손쉬운 사용 필요 여부 |
| `fullDiskAccess` | 전체 디스크 접근 필요 여부 |

제작 모듈의 검증 게이트가 스크립트를 훑어 선언과 실제가 맞는지 본다(`tell application "X"`가 있는데 `automation`에 X가 없으면 실패).

### 3.6 설정과 비밀

둘 다 **값은 패키지에 없다.** 내보내기에서 자동으로 빠지고, 설치하는 쪽에서 입력받는다.

- `settings`: 사용자가 바꾸는 값. `key`, `label`, `type`(`string`·`number`·`boolean`·`list`·`choice`), `default`, `required`, `choice`면 `options`.
- `secrets`: 키·토큰. `key`, `label`, `required`. 보관은 Keychain(미정, [plan 15절](hackmac-v2-plan.md#15-나중에-정할-것)).
- 스크립트는 `$HACKMAC_SETTING_<KEY>`, `$HACKMAC_SECRET_<KEY>`로 받는다. 파일로 쓰지 않는다.
- `required`인데 값이 없으면 켜기 전에 입력 화면이 뜬다.

### 3.7 참고

`references`: [plan 13.2](hackmac-v2-plan.md#132-참고-기록)의 "참고한 것". 레시피 참고 블록의 원본이고, 라이선스 표기의 근거다. 실행에는 쓰이지 않는다.

## 4. 검증 규칙

보관소가 설치·업그레이드 때, 제작 모듈이 검증 게이트에서 돌린다. 하나라도 실패하면 설치하지 않는다.

1. `schema`를 아는 판인가.
2. 필수 항목이 다 있고 형식이 맞는가.
3. `triggers[].script`가 패키지 안에 있고 실행 가능한가. 패키지 밖 경로(`..`, 절대경로)가 없는가.
4. `capabilities`의 모든 능력이 이 HackMac에 있고 버전 범위를 만족하는가. 없으면 "HackMac 업데이트 필요"와 부족한 목록.
5. `hackmac.min` ≤ 지금 버전.
6. 스크립트 안에 절대경로(`/Users/`), API 키처럼 보이는 문자열, `capabilities`에 없는 능력 호출, `permissions.automation`에 없는 `tell application`이 없는가(이식성·권한 일치).
7. 스크립트가 OpenAI·Anthropic API를 직접 부르지 않는가(`ai` 능력으로만, [plan 13.1](hackmac-v2-plan.md#131-원칙-결정-앱은-참고만-의존은-플랫폼이)).
8. 패키지 안에 `node_modules/`, 바이너리, 심볼릭 링크가 없는가.
9. `hotkey` 트리거의 `key`가 앱 안에서 유일하고, 선언에 키 조합(`Alt+…`)이 직접 적혀 있지 않은가. 카피에 `Alt+`·`Cmd+` 같은 키 조합이 직접 쓰이지 않았는가(`{hotkey:<key>}`만 허용).

6~8은 "정직한 앱"을 거르는 검사다. 선언보다 많은 일을 하는 악의적 스크립트는 못 막는다.

## 5. v1과 달라지는 것

| | v1 | v2 | 이유 |
|---|---|---|---|
| 단축키 메타데이터 | 스크립트 헤더 `@svc-name` 등 | `manifest.triggers[]` | 상주·스케줄·로그인은 "스크립트 하나당 단축키 하나"로 표현되지 않는다. 설치 때 기계가 검증해야 하므로 한 파일에 모은다. v1의 "DB를 따로 두지 않는다"는 원칙은 유지된다(manifest가 그 자리) |
| 단축키 조합 | 앱이 정함(`@svc-hotkey: Alt+1`) | HackMac이 자리 목록에서 배정 | 충돌 없음, 이식성, 에이전트가 안전한 키를 추측할 필요 없음 |
| 서비스 id | `gtd-reminders` | `<작성자>.<이름>` | 다른 사람의 앱과 충돌 방지 |
| 버전 | 없음(앱 번들 버전) | 앱마다 정수 | 되돌리기, 자동 수정 |
| 능력 | 암묵(`$HACKMAC_POPUP` 환경변수) | 선언 + 버전 범위 | 앱이 HackMac보다 오래 산다 |
| 권한 | 없음 | 선언 | 설치 때 요약 |
| 설정/비밀 | 스크립트 안 상수 | 선언 + 환경변수 | 이식성 |

v1 GTD 서비스를 v2 앱으로 옮길 때는 `@svc-*` 헤더를 `triggers`로 뽑는 변환 한 번이면 된다(`electron/parser.ts`가 이미 읽는다). `@svc-hotkey` 값은 버리고 `key`만 남기며, 카피의 "(Alt+1)"은 `{hotkey:<key>}`로 바꾼다.

## 6. 정해야 할 것

1. **상주 앱의 생존 신호 방식.** stdout에 정해진 줄을 찍는가, 소켓에 ping을 보내는가. 스크립트 작성자(에이전트)가 가장 틀리기 어려운 쪽.
2. **`event` 트리거의 사건 어휘.** 어떤 능력이 어떤 사건을 내는지. 1차에 넣을지.
3. **`ai` 능력의 인터페이스.** 글 한 덩이 → 글 한 덩이면 충분한가, 도구 호출까지 여는가. 백그라운드 앱의 한도 소모 표시와 연결.
4. **`version`을 정수로 할지.** 사용자가 버전을 직접 정할 일이 없다는 전제. 레시피로 다시 만든 앱은 1부터 다시 시작.
5. **스토어 카피 8항목을 전부 필수로 둘지.** 사용자가 혼자 쓰는 앱에 `differentiators` 6줄은 과하다. "짧은 카피"(name·tagline·usage만)와 "완전 카피"를 나눌지.
