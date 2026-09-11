# 디자인 시스템

HackMac은 "서비스를 켜고 끄는 제품"이다 — 사용자가 단축키를 직접 만드는 도구가 아니라, 이미 완성된 기능을 쓰는 것이라 UI가 스크립트만큼이나 제품의 일부다. 그래서 사용자가 보는 화면은 스토어 그리드·상세 페이지 같은 앱 자체 화면부터, 서비스를 쓰는 도중 뜨는 선택/입력 팝업까지 전부 **하나의 디자인 시스템**을 따른다. 이 문서가 그 시스템의 정의다.

레퍼런스는 [Linear](https://linear.app)다. 마케팅 페이지의 그라디언트·글로우가 아니라 Linear의 **실제 앱 UI**를 기준으로 삼았다 — 거의 완전히 평평한 다크 서페이스, 미세한 밝기 단계로만 구분되는 무채색, 인디고 한 가지로만 절제해서 쓰는 악센트. `/Users/jiho-mac/Projects/999. RESOURCES/design-reference/linear.app.md`가 원본 레퍼런스이고, 이 문서는 그걸 HackMac이라는 macOS 유틸리티에 맞게 옮긴 결과다.

## 토큰이 사는 곳

값 자체의 source of truth는 이 문서가 아니라 코드다 — 여기 적힌 값이 코드와 달라 보이면 코드를 믿는다.

- `src/theme.css`의 `:root` — 앱 전체(스토어 그리드, 상세 페이지, 토스트)와 팝업이 공유하는 색/반경/이징 토큰.
- `src/popup/popup.css` — 팝업 전용 레이아웃(카드 쉘, 리스트 행, 액션 바). 색은 전부 `theme.css` 토큰을 그대로 참조하고 새 색을 만들지 않는다.

## 색

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--bg` | `#08090a` | 앱 창 배경 |
| `--surface` | `#0e0f11` | 카드/입력창 기본 면 |
| `--surface-hover` | `#17181b` | 카드/행 hover |
| `--surface-raised` | `#1c1d20` | 토스트, 팝업 카드, `kbd` — 배경 위로 살짝 뜬 요소 |
| `--border` | `rgba(255,255,255,.08)` | 기본 구분선 — 진한 회색 대신 배경보다 밝은 반투명 흰색 한 겹 |
| `--border-strong` | `rgba(255,255,255,.15)` | hover/active 시 구분선 |
| `--text` | `#f4f5f6` | 본문 텍스트 |
| `--text-dim` | `#8a8f98` | 보조 텍스트(태그라인, 설명) |
| `--text-faint` | `#62666d` | 가장 약한 텍스트(라벨, placeholder급) |
| `--accent-default` | `#5e6ad2` | Linear 시그니처 인디고. 서비스 카드는 `manifest.json`의 `accentColor`로 이 기본값을 서비스마다 미세하게 바꿔 쓴다 |
| `--danger` | `#eb5757` | 에러 |
| `--ok` | `#4cb782` | 활성/완료 상태 |

무채색 서페이스 위에 악센트는 **한 곳에만** 쓴다 — 카드 아이콘 배경, 활성 상태 테두리, 팝업의 primary 버튼과 선택된 행. 두 가지 이상의 크로매틱 색을 동시에 쓰지 않는다(Linear 원 레퍼런스의 "악센트는 브랜드 마크·포커스 링·의도된 CTA에만, 절대 장식적으로 쓰지 않는다" 원칙을 그대로 따른다).

## 타이포그래피

웹폰트를 쓰지 않는다 — 네이티브 macOS 유틸리티라 시스템 폰트(`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Apple SD Gothic Neo', 'Pretendard'`)를 그대로 쓰고, Linear 특유의 "촘촘하고 단단한" 인상은 자간(`-0.01em` 안팎)과 굵기(590)로 낸다. 기준 크기는 13px(macOS 유틸리티 앱 표준 본문 크기), 팝업 타이틀은 13px/600, 리스트 행은 12.5px.

## 반경 · 이징

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--radius-sm` | 6px | 버튼, 입력창, 리스트 행 |
| `--radius-md` | 8px | 아이콘 타일 |
| `--radius-lg` | 10px | 카드(스토어 카드, 토스트) |
| `--radius-xl` | 14px | 팝업 카드 — 앱 안의 가장 큰 반경보다 한 단계 더 커서, 화면 위에 "떠 있는 독립된 창"이라는 인상을 준다 |
| `--ease` | `cubic-bezier(0.16, 1, 0.3, 1)` | 모든 트랜지션/애니메이션 |

## 컴포넌트

### 앱 화면 (스토어 · 상세 · 토스트)

`src/theme.css`에 이미 구현돼 있다 — 카드는 `--surface` 배경에 `--border` 헤어라인, hover 시 `--surface-hover` + `--border-strong`, 활성 서비스는 `color-mix(in srgb, var(--accent) 40%, var(--border))`로 테두리만 은은하게 물들인다(배경을 통째로 칠하지 않음). `prefers-reduced-motion`을 존중해 애니메이션을 끌 수 있다.

### 팝업 (선택 · 입력 · 확인)

`electron/popupWindow.ts`가 띄우는 별도 창, `src/popup/PopupApp.tsx` + `popup.css`가 그린다. 창 자체는 `frame:false` + `transparent:true`라 각진 사각형이 아니라 `.popup-card`가 그리는 둥근 카드 하나만 보인다.

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
- 팝업에 새로운 모양이 필요해지면(예: 여러 개 동시 선택) `shared/types.ts`의 `PopupRequest`에 kind를 추가하고, `src/popup/PopupApp.tsx`에 컴포넌트를 추가하되 색/반경/타이포는 반드시 기존 토큰을 그대로 쓴다 — 팝업만의 새 팔레트를 만들지 않는다.
- UI를 바꿨으면 `npm run dev`로 실제 창(과 가능하면 팝업)을 띄워 확인한다 — CLAUDE.md의 공통 규칙이 여기도 그대로 적용된다.
