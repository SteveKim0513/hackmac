# HackMac

미리 기획한 단축키+스크립트 "서비스"를 앱스토어처럼 켜고 끄는 완성형 macOS 앱.

[mac-shortcut-manager](../mac-shortcut-manager)와 실행 엔진(전역 단축키 등록, 스크립트 실행)은 같지만
사용자 경험은 정반대다 — 사용자가 직접 단축키를 만드는 도구가 아니라, 개발자가 이미 만들어둔
기능을 그대로 켜서 쓰는 제품이다. 배경은 [LOCKED-DOWN-APP-PROPOSAL.md](LOCKED-DOWN-APP-PROPOSAL.md) 참고.

## 사용자 경험

1. 앱을 열면 홈 화면이 앱스토어처럼 서비스 카드 그리드로 보인다.
2. 꺼져 있는 서비스 카드를 누르면 켜진다 (그 서비스의 단축키가 전역으로 등록된다).
3. 켜진 서비스 카드를 누르면 상세 페이지로 들어간다 — 무엇인지, 차별점, 왜 강력한지, 사용법, 단축키 목록.
4. 상세 페이지에서도 켜기/끄기를 바로 토글할 수 있다.

## 서비스 구조

`resources/services/<service-id>/`
- `manifest.json` — 스토어용 설명 (이름/태그라인/아이콘/차별점/강점/사용법). 서비스 하나에 대응하는 앱 단위 정보라 스크립트 헤더에 넣을 수 없다.
- `scripts/*.sh` — 단축키 하나당 스크립트 하나. 이름/단축키/설명은 스크립트 상단 `# @svc-*` 주석이 진실의 원천이다 (mac-shortcut-manager의 `@msm-*` 관례를 그대로 이어받음).

번들 리소스는 앱 실행 중 바뀌지 않으므로 시작 시 1회만 스캔한다 — 폴더 워처 없음.

## 지금 들어있는 서비스

- **미리알림 GTD** (`gtd-reminders`) — David Allen의 GTD를 macOS 미리알림 위에서 구현한 todo 관리. 수집(⌘⇧I)·처리(⌘⇧P)·다음 행동 확인(⌘⇧N)·대기중 확인(⌘⇧W)·주간 검토(⌘⇧R) 다섯 단축키가 GTD 다섯 단계에 대응한다.

## 개발

```bash
npm install
npm run dev          # Electron + Vite 개발 서버
npm run typecheck
npm run build
```

자세한 개발 노트와 이 환경에서 겪은 함정은 [CLAUDE.md](CLAUDE.md) 참고.

## 배포

```bash
npm run dist          # Developer ID 서명 + 공증까지 끝난 .dmg/.zip을 release/에 생성
```

공증 자격증명은 `.env` 같은 평문 파일이 아니라 macOS Keychain 프로필(`hackmac-notary`, `xcrun notarytool store-credentials`로 등록)에서 가져온다 — `npm run dist`가 `APPLE_KEYCHAIN_PROFILE=hackmac-notary`를 자동으로 넘긴다. 다른 Mac에서 처음 배포 빌드를 하려면 그 Mac에서 프로필을 먼저 등록해야 한다. 절차와 검증 커맨드는 [CLAUDE.md의 "배포 서명 · 공증"](CLAUDE.md#배포-서명--공증-다른-mac에-설치할-때-gatekeeper-경고-없애기) 참고.
