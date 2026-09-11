# 디자인 시스템

HackMac은 "서비스를 켜고 끄는 제품"이다 — 사용자가 단축키를 직접 만드는 도구가 아니라, 이미 완성된 기능을 쓰는 것이라 UI가 스크립트만큼이나 제품의 일부다. 그래서 사용자가 보는 화면은 스토어 그리드·상세 페이지 같은 앱 자체 화면부터, 서비스를 쓰는 도중 뜨는 선택/입력 팝업까지 전부 **하나의 디자인 시스템**을 따른다. 이 문서가 그 시스템의 정의다.

레퍼런스는 macOS의 **App Store 앱**이다 — "서비스를 스토어에서 골라 켠다"는 이 제품의 정체성과 가장 가까운 네이티브 경험이기 때문이다. 마케팅 이미지가 아니라 실제 macOS App Store 앱 UI를 기준으로 삼았다: 거의 흰색에 가까운 서페이스, 큰 반경의 카드, 옅은 그림자로 띄운 레이어 위계, 그리고 GET → OPEN으로 바뀌는 캡슐형 버튼 하나로 설치/실행 상태를 표현하는 방식. HackMac에서는 이 버튼이 "꺼짐/켜짐" 토글로 바뀐다.

## 토큰이 사는 곳

값 자체의 source of truth는 이 문서가 아니라 코드다 — 여기 적힌 값이 코드와 달라 보이면 코드를 믿는다.

- `src/theme.css`의 `:root` — 앱 전체(스토어 그리드, 상세 페이지, 토스트)와 팝업이 공유하는 색/반경/그림자/이징 토큰.
- `src/popup/popup.css` — 팝업 전용 레이아웃(카드 쉘, 리스트 행, 액션 바). 색은 전부 `theme.css` 토큰을 그대로 참조하고 새 색을 만들지 않는다.

## 색

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--bg` | `#fbfbfd` | 앱 창 배경 |
| `--surface` | `#ffffff` | 카드/입력창 기본 면 |
| `--surface-hover` | `#f5f5f7` | 카드 hover, 보조 버튼 배경, kbd 칩 |
| `--surface-raised` | `#ffffff` | 토스트, 팝업 카드 — 그림자(`--shadow-float`)로 배경보다 떠 있는 느낌을 낸다 |
| `--border` | `rgba(0,0,0,.08)` | 기본 구분선 — 진한 회색 대신 옅은 반투명 검정 한 겹 |
| `--border-strong` | `rgba(0,0,0,.14)` | hover/active 시 구분선 |
| `--text` | `#1d1d1f` | 본문 텍스트 |
| `--text-dim` | `#6e6e73` | 보조 텍스트(태그라인, 설명) |
| `--text-faint` | `#86868b` | 가장 약한 텍스트(라벨, placeholder급) |
| `--accent-default` | `#0071e3` | App Store의 GET/OPEN 버튼·링크에 쓰이는 애플 블루. 서비스 카드는 `manifest.json`의 `accentColor`로 이 기본값을 서비스마다 미세하게 바꿔 쓴다 |
| `--danger` | `#ff3b30` | 에러 |
| `--ok` | `#30d158` | 예약됨(현재 활성 상태 표현은 버튼 자체의 GET→OPEN 색 전환으로 대신한다) |

무채색 서페이스 위에 악센트는 **한 곳에만** 쓴다 — 카드 아이콘 배경, 활성 상태 테두리, GET/OPEN 캡슐, 팝업의 primary 버튼과 선택된 행. 두 가지 이상의 크로매틱 색을 동시에 쓰지 않는다 — App Store 원 레퍼런스도 블루 하나를 구매/실행 동작에만 쓰고 나머지는 전부 무채색이다.

### 다크 모드

위 표는 라이트 값이고, `src/theme.css`의 `:root[data-theme='dark']`가 macOS 다크 모드용 값(애플 시스템 그레이 `#1c1c1e`/`#2c2c2e`/`#3a3a3c` 단계, 다크 전용으로 더 밝힌 시스템 블루 `#0a84ff`)을 따로 정의한다. 사용자는 헤더의 라이트/다크/시스템 세그먼트 컨트롤(`src/components/ThemeSwitch.tsx`)로 고르고, `electron/main.ts`가 그 선택을 `nativeTheme.themeSource`에 반영한 뒤 `theme:changed` IPC로 모든 창(메인 창 + 팝업 창)에 결과를 밀어준다 — `src/main.tsx`가 그 값을 받아 `<html data-theme>`을 세팅한다.

CSS `prefers-color-scheme` 미디어쿼리가 아니라 이 IPC→속성 방식을 쓰는 이유는 실측 버그 때문이다: `nativeTheme.themeSource`를 바꿔도 일부 창(특히 화면 밖에 뜨는 창)에서 `window.matchMedia('(prefers-color-scheme: dark)')`가 실시간으로 안 따라오는 경우를 확인했다 — 자세한 재현 조건은 [CLAUDE.md의 "환경에서 겪은 것들"](../CLAUDE.md)에 남겨뒀다. 새 색을 다크 모드용으로 추가할 때도 미디어쿼리가 아니라 `:root[data-theme='dark']` 블록에 넣는다.

## 타이포그래피

웹폰트를 쓰지 않는다 — 네이티브 macOS 유틸리티라 시스템 폰트(`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Apple SD Gothic Neo', 'Pretendard'`)를 그대로 쓴다 — App Store 본체도 SF Pro Display/Text를 그대로 쓰지 웹폰트로 바꾸지 않는다. 페이지 타이틀("HackMac", 서비스 이름)은 크고 굵게(28px/700, 22px/700, 자간 -0.02em 안팎)로 App Store의 큰 타이틀 인상을 내고, 본문은 13px(macOS 유틸리티 앱 표준 본문 크기) 기준으로 돌아간다.

## 반경 · 그림자 · 이징

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--radius-sm` | 8px | 입력창 |
| `--radius-md` | 10px | 아이콘 타일(32px대) |
| `--radius-lg` | 16px | 카드(스토어 카드, 토스트) |
| `--radius-xl` | 20px | 팝업 카드 — 앱 안의 가장 큰 반경보다 한 단계 더 커서, 화면 위에 "떠 있는 독립된 시트"라는 인상을 준다 |
| `--radius-full` | 999px | GET/OPEN 캡슐, 헤더 보조 버튼, 팝업 버튼 — App Store 전역에서 반복되는 캡슐 모양 |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 6px 16px rgba(0,0,0,.06)` | 스토어 카드의 기본 부양감 |
| `--shadow-card-hover` | 더 깊은 버전의 `--shadow-card` | 카드 hover 시 살짝 들리는 효과 |
| `--shadow-float` | `0 8px 24px rgba(0,0,0,.12), 0 24px 64px rgba(0,0,0,.16)` | 토스트, 팝업 카드처럼 배경 위에 떠 있는 레이어 |
| `--ease` | `cubic-bezier(0.16, 1, 0.3, 1)` | 모든 트랜지션/애니메이션 |

App Store는 무채색 카드를 진한 테두리로 구분하지 않고 **옅은 그림자로 층을 나눈다** — 그래서 이 시스템도 `--border`는 거의 보이지 않을 정도로 약하게 두고, 카드의 존재감은 `--shadow-card`가 대부분 책임진다.

## 컴포넌트

### 앱 화면 (스토어 · 상세 · 토스트)

`src/theme.css`에 이미 구현돼 있다 — 카드는 `--surface`(흰색) 배경에 `--shadow-card`로 살짝 띄우고, hover 시 그림자가 깊어지며 2px 위로 들린다. 활성 서비스는 `color-mix(in srgb, var(--accent) 35%, var(--border))`로 테두리만 은은하게 물들인다(배경을 통째로 칠하지 않음). `prefers-reduced-motion`을 존중해 애니메이션을 끌 수 있다.

서비스 카드/상세 페이지의 상태 표시는 App Store의 **GET → OPEN** 전환을 그대로 옮긴 캡슐이다: 꺼진 상태는 악센트를 10%만 섞은 옅은 배경 + 악센트색 텍스트(=GET), 켜진 상태는 악센트로 완전히 채운 배경 + 흰 텍스트(=OPEN)다. 새 상태를 추가할 때도 이 "옅은 틴트 → 완전 채움" 패턴을 벗어나지 않는다.

키보드 포커스는 브라우저 기본 파란 링이 아니라 `--accent-default` 2px 아웃라인을 쓴다(`:focus-visible`이라 마우스 클릭에는 안 뜨고 키보드 탐색에서만 뜬다) — macOS 네이티브 포커스 링과 같은 색이라 튀지 않는다.

메인 창은 `titleBarStyle: 'hiddenInset'`이라 macOS 트래픽라이트(닫기/최소화/최대화)가 콘텐츠 위에 떠 있다. `electron/main.ts`가 `trafficLightPosition: { x: 20, y: 20 }`으로 위치를 고정하고, `.app-shell`이 왼쪽에만 92px 여백(`padding: 28px 36px 60px 92px`)을 둬서 "HackMac" 제목이 트래픽라이트와 붙어 보이지 않게 한다 — OS 기본값에 맡기면 이 간격이 macOS 버전마다 달라진다.

### 팝업 (선택 · 입력 · 확인)

`electron/popupWindow.ts`가 띄우는 별도 창, `src/popup/PopupApp.tsx` + `popup.css`가 그린다. 창 자체는 `frame:false` + `transparent:true`라 각진 사각형이 아니라 `.popup-card`가 그리는 둥근 카드 하나만 보인다 — `--shadow-float`로 배경 위에 떠 있는 시트처럼 보이게 한다.

서비스 스크립트뿐 아니라 **앱 자신도** 이 팝업을 쓴다 — 예를 들어 `electron/updater.ts`의 "새 버전 준비됨, 지금 재시동할까요?"는 Electron의 네이티브 `dialog.showMessageBox`가 아니라 메인 프로세스에서 `popupWindow.ts`의 `requestPopup()`을 직접 호출한다(소켓을 거칠 필요 없이 같은 프로세스 안이라 함수 호출로 끝난다). **이 앱 안에서 사용자에게 무언가를 확인받아야 하는 순간은 예외 없이 이 팝업을 거친다** — 네이티브 다이얼로그가 조금이라도 섞이면 "하나의 디자인 시스템"이라는 전제가 깨진다.

세 가지 모양이 있고, 서비스 스크립트는 이 중 하나를 `$HACKMAC_POPUP`로 요청한다(호출 방법은 [CLAUDE.md의 "서비스 설계 원칙"](../CLAUDE.md#서비스-설계-원칙) 참고):

- **select** — `choose from list` 대체. 제목 + 설명 + 스크롤 가능한 리스트 + 취소/기본 버튼.
  - **행을 한 번 클릭하면 그 즉시 선택되고 창이 닫힌다** — "박스를 먼저 활성화하고 다시 클릭해야 하는" 기존 macOS 다이얼로그의 2클릭 문제를 없애는 게 이 팝업 시스템을 만든 직접적인 이유였다.
  - 방향키(↑/↓)로 하이라이트 이동, Enter로 하이라이트 선택, Esc로 취소 — 마우스 없이도 완결된다.
  - 기본 선택 항목(`defaultItem`)이 있으면 처음부터 하이라이트해둔다.
- **prompt** — `display dialog ... default answer` 대체. 제목 + 설명 + 텍스트 입력(자동 포커스+전체선택) + 취소/기본 버튼. Enter 제출, Esc 취소.
- **confirm** — 버튼만 있는 `display dialog` 대체. 취소할 게 없는 순수 정보 표시(예: 업무 현황보기)는 `cancelLabel`을 빈 문자열로 보내 취소 버튼 자체를 숨긴다 — 이때 Esc는 취소가 아니라 그냥 닫기로 동작한다.

팝업 창 크기는 내용에 맞춰 `electron/popupWindow.ts`가 미리 계산한다(리스트 행 수, confirm 메시지의 줄 수) — 고정 크기 다이얼로그처럼 텍스트가 잘리거나 빈 여백이 남지 않게 하기 위해서다.

## 이 시스템을 지키는 법

- 새 색을 추가하고 싶으면 먼저 위 표에 있는 토큰으로 표현할 수 없는지 확인한다. 대부분은 `color-mix(in srgb, var(--accent) N%, var(--surface))`처럼 기존 토큰을 섞어서 해결된다.
- 새로운 "상태"가 필요해지면(온/오프 말고 제3의 상태 등) App Store의 GET → 진행 중 → OPEN 같은 3단 전환을 참고하되, 색은 항상 `--accent-default` 하나의 틴트 농도 변화로만 표현한다 — 두 번째 크로매틱 색을 끌어오지 않는다.
- 팝업에 새로운 모양이 필요해지면(예: 여러 개 동시 선택) `shared/types.ts`의 `PopupRequest`에 kind를 추가하고, `src/popup/PopupApp.tsx`에 컴포넌트를 추가하되 색/반경/타이포는 반드시 기존 토큰을 그대로 쓴다 — 팝업만의 새 팔레트를 만들지 않는다.
- UI를 바꿨으면 `npm run dev`로 실제 창(과 가능하면 팝업)을 띄워 확인한다 — CLAUDE.md의 공통 규칙이 여기도 그대로 적용된다.
