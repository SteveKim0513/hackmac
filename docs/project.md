# 프로젝트 가이드: HackMac

일반 가이드(스튜디오 팀 문서와 `/fix`)가 "프로젝트 가이드를 본다"고 한 값을 모으는 곳이다. 일반 가이드와 이 문서가 부딪히면 이 문서가 이긴다. 이 파일은 프로젝트가 주인이라 `setup.sh`가 덮어쓰지 않는다.

## 1. 기본

| 항목 | 값 |
|---|---|
| 하는 일 | 완성된 서비스(단축키 묶음)를 켜고 끄는 macOS 서비스 스토어 |
| 설계 문서 | [LOCKED-DOWN-APP-PROPOSAL.md](../LOCKED-DOWN-APP-PROPOSAL.md), `CLAUDE.md` "서비스 설계 원칙" |
| 지금 단계 | README의 "지금 들어있는 서비스" |
| 기술 | Electron + React + TypeScript, npm. 배포는 GitHub Releases(`SteveKim0513/hackmac`) + electron-updater |
| 검증 명령 | `CLAUDE.md` "Required Commands" |
| 디자인 값 | [docs/design.md](design.md) |
| 용어집 | 해당 없음 |

## 2. 단계와 스킬

| 단계 | 할 일 | 쓰는 스킬 | 확인 방법 |
|---|---|---|---|
| 승격 | mac-shortcut-manager 단축어를 서비스로 옮기기 | `/promote-to-playbook`(프로젝트 스킬) | [docs/playbook-graduation.md](playbook-graduation.md) |

## 3. 층과 데이터

- 구조와 사실의 주인: `CLAUDE.md` "Architecture"와 "서비스 설계 원칙"(스크립트 헤더 `@svc-*`와 `manifest.json`이 유일한 원천).

## 4. 바깥과 주고받기, 권한 경계

- 해당 없음(로컬 앱. 배포와 계정 규칙은 `CLAUDE.md` "배포 서명 · 공증", "자동 업데이트").
