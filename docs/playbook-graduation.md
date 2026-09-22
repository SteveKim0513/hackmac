# mac-shortcut-manager ↔ Playbook 관계

두 프로젝트는 같은 엔진(전역 단축키 등록 + `/bin/zsh` 스크립트 실행)을 쓰지만 역할이 다르다.

- **mac-shortcut-manager** — 자유롭게 단축어를 만들고, 고치고, 써보는 실험 공간. `~/Documents/ShortcutScripts`의
  `.sh` 파일이 곧 상태이고, 사용자가 직접 편집한다.
- **Playbook(이 저장소)** — 그중 완성도가 검증된 것만 "서비스"로 다시 태어나는 곳. 서비스는 앱에 번들된 읽기
  전용 리소스이고, 편집 UI가 없다. 배경은 [LOCKED-DOWN-APP-PROPOSAL.md](../LOCKED-DOWN-APP-PROPOSAL.md) 참고.

이 문서는 "괜찮은 단축어가 나오면 Playbook 서비스로 만든다"는 흐름을 어떻게 다루는지 정리한다.

## 왜 실시간으로 연동하지 않는가

Playbook이 mac-shortcut-manager의 `~/Documents/ShortcutScripts` 폴더를 실시간으로 감시해서 자동으로
서비스를 만들어내는 구조는 만들지 않는다. 이유:

1. **설계 철학이 정반대다.** mac-shortcut-manager는 "폴더가 곧 상태"(자유롭게 편집)고, Playbook은 "번들
   리소스는 런타임에 바뀌지 않는다"(잠금). 하나가 다른 하나의 폴더를 실시간으로 들여다보면 이 둘 중 하나는
   거짓말이 된다.
2. **승격의 핵심 작업은 파일 복사가 아니라 카피 작성이다.** 어떤 스크립트가 서비스로서 차별점이 있는지,
   왜 강력한지, 어떻게 써야 하는지는 사람(과 Claude와의 대화)이 판단해서 써야 한다
   ([docs/service-copy-guide.md](service-copy-guide.md) 참고) — 자동화해도 이 부분은 그대로 남는다.
3. 자동 동기화는 두 프로젝트를 다시 묶어버려서, 애초에 별도 레포로 분리한 이유(다른 배포 주기, 다른
   서명 아이덴티티, 다른 사용자 경험)를 무의미하게 만든다.

그래서 승격은 **명시적으로 한 번 실행하는 절차**다 — 자동으로 일어나지 않는다.

## 승격이 실제로 바꾸는 것

| mac-shortcut-manager | Playbook |
|---|---|
| `~/Documents/ShortcutScripts/*.sh` (사용자 편집 가능) | `resources/services/<id>/scripts/*.sh` (앱 번들, 읽기 전용) |
| `# @msm-name` / `@msm-hotkey` / `@msm-description` | `# @svc-name` / `@svc-hotkey` / `@svc-description` |
| `# @msm-icon` / `@msm-category` (스크립트 단위) | 서비스 단위 `icon`/`accentColor` (`manifest.json`) |
| `@msm-trigger`(schedule/login/wake/folder) | 지원 안 함 — 단축키 트리거만 이관 가능 |
| (스토어 카피 없음, 매니저 UI가 곧 설명) | `manifest.json`의 `tagline`/`whatItIs`/`differentiators`/`strengths`/`usage` — 새로 써야 함 |

여러 개의 관련 스크립트가 하나의 서비스로 묶일 수도 있다(예: `gtd-reminders`는 스크립트 8개가 하나의
서비스 스토리로 묶인 경우). 1:1 복사가 아니라 "이 스크립트들을 묶으면 하나의 서비스 스토리가 되는가"를
판단하는 일이라는 걸 기억할 것.

## 절차: `/promote-to-playbook`

실제 승격 작업은 이 저장소의 스킬 [`.claude/skills/promote-to-playbook`](../.claude/skills/promote-to-playbook/SKILL.md)이
수행한다 — 원본 스크립트 읽기 → 헤더 변환 → `/copywriting` 스킬 호출 + `docs/service-copy-guide.md`로 카피
작성 → 검증 → (원하면) 재빌드/배포까지 한 번에 진행하는 절차형 문서다. 승격하고 싶은 스크립트가 생기면
그 스킬을 실행한다.

mac-shortcut-manager 쪽에서 "이건 Playbook 후보다"라고 표시해두는 관례(`# @msm-candidate: playbook`)와
그 프로젝트에서 해야 할 남은 작업은 그 저장소의
[`docs/playbook-graduation.md`](../../mac-shortcut-manager/docs/playbook-graduation.md)에 남겨뒀다 — 이
저장소에서는 그 표시 자체를 강제하지 않는다. 사용자가 스크립트 경로를 직접 알려줘도 승격은 그대로 진행된다.

## 구조적 한계: 항상 재빌드가 필요하다

Playbook은 서비스 목록을 앱 시작 시 한 번만 스캔하고(`electron/services.ts`), 패키징할 때는
`extraResources`로 리소스를 앱 번들 안에 굳힌다. 그래서 새 서비스는 코드를 아무리 잘 작성해도 **앱을 다시
빌드(`npm run dist`)하고 재설치해야만** 실제로 나타난다 — 이건 버그가 아니라 "완성형 제품, 편집 UI 없음"
설계의 자연스러운 결과다. 승격 스킬의 마지막 단계가 재빌드/배포 여부를 물어보는 이유이기도 하다.
