---
name: promote-to-playbook
description: "mac-shortcut-manager의 완성된 단축어(들)를 Playbook의 새 서비스로 승격한다. 어떤 스크립트를 서비스로 만들지 정했을 때 사용."
---

# /promote-to-playbook

mac-shortcut-manager는 자유롭게 단축어를 만들고 써보는 공간이고, Playbook은 그중 완성도가 검증된 것만
"서비스"로 다시 태어나는 곳이다. 이 스킬은 그 승격 절차를 담당한다 — 자동 동기화가 아니라 한 번 실행하는
명시적 변환 + 카피 작성 작업이다. 배경은 [docs/playbook-graduation.md](../../../docs/playbook-graduation.md) 참고.

## 사전 조건

- 승격할 스크립트의 경로 또는 이름 (보통 `~/Documents/ShortcutScripts/*.sh`). 사용자가 지정하지 않았으면
  먼저 물어본다 — `# @msm-candidate: playbook` 주석이 붙은 스크립트가 있으면 그것부터 후보로 제안한다
  (이 주석은 mac-shortcut-manager 쪽에 아직 파싱 코드가 없는 순수 관례이므로, `grep`으로 직접 찾는다).
- 여러 스크립트를 하나의 서비스로 묶을지, 하나씩 별도 서비스로 만들지 결정한다. 애매하면 사용자에게
  묻는다 (예: `gtd-reminders`는 스크립트 5개가 하나의 서비스 스토리로 묶인 경우).

## 실행 순서

### Step 1: 원본 읽기

대상 `.sh` 파일(들)을 읽고 `@msm-name`/`@msm-hotkey`/`@msm-description`/`@msm-icon`/`@msm-category` 헤더를
파악한다. `@msm-trigger`(schedule/login/wake/folder)가 있으면 Playbook은 이 트리거를 지원하지 않는다는 걸
사용자에게 알린다 — 단축키 트리거만 이관 가능하다.

### Step 2: 서비스 뼈대 정하기

- 서비스 `id`(kebab-case), `name`, `icon`(원본 스크립트들의 `@msm-icon`을 참고하되 서비스 전체를 대표하는
  하나로), `accentColor`를 정한다.
- `resources/services/<id>/scripts/`를 만들고 각 스크립트를 복사한다.

### Step 3: 헤더 변환

각 스크립트에서 (`electron/parser.ts`의 `@svc-*` 정규식과 맞는지 확인하며):

- `@msm-name` → `@svc-name`
- `@msm-hotkey` → `@svc-hotkey`
- `@msm-description` → `@svc-description` — 그대로 옮기지 말 것. 이건 스크립트 단위 설명이고, 서비스
  전체의 스토리는 `manifest.json`이 별도로 책임진다(Step 4).
- `@msm-icon`/`@msm-category`는 제거한다 — 서비스 레벨 정보로 흡수했으므로 스크립트에는 불필요하다.

### Step 4: 카피 작성 — 반드시 `/copywriting` 스킬 호출

`manifest.json`(`tagline`/`whatItIs`/`differentiators`/`strengths`/`usage`)을 쓰기 전에:

1. `/copywriting` 스킬을 호출한다.
2. [docs/service-copy-guide.md](../../../docs/service-copy-guide.md)를 읽는다.
3. 원본 스크립트의 `@msm-description`은 참고자료일 뿐이다 — 그대로 베끼면 이 가이드의 "제품 설명으로
   시작하지 않는다" 규칙을 어기게 된다. 사용자 상황(장면) → (생소한 개념이면 그 개념 설명) → 차별점 →
   왜 강력한지 → 사용법 순서로 새로 쓴다.

### Step 5: 검증

```bash
python3 -m json.tool resources/services/<id>/manifest.json   # JSON 유효성
npm run typecheck
```

가능하면 `npm run dev`로 실제 스토어 화면·상세 페이지까지 확인한다. 자동화 클릭이 이 환경에서 불안정할
수 있다(`CLAUDE.md`의 "환경에서 겪은 것들" 참고) — 안 되면 사용자에게 직접 확인을 부탁하고 넘어간다.

### Step 6: 원본 처리 확인

mac-shortcut-manager 쪽 원본 스크립트를 어떻게 할지 사용자에게 묻는다. 기본은 **그대로 둔다** — 원본 앱은
독립적으로 계속 쓰는 도구이므로 승격했다고 자동으로 지우거나 바꾸지 않는다. `@msm-candidate` 표시를
지울지도 사용자 선택에 맡긴다.

### Step 7: 배포 여부 확인

사용자가 원하면 `npm run dist`로 다시 빌드하고 `/Applications`에 설치한다. Playbook은 번들 리소스를 빌드
시점에 굳히므로, 새 서비스는 앱을 다시 빌드해야만 실제로 나타난다.

## 완료 기준

- `resources/services/<id>/manifest.json`이 유효하고 `docs/service-copy-guide.md` 체크리스트를 통과한다.
- `npm run typecheck` 통과.
- 원본 mac-shortcut-manager 스크립트는 사용자가 원한 대로 처리됐다 (기본: 그대로 둠).

## 완료 보고 형식

```
승격한 서비스: <id> (<name>)
원본 스크립트: <mac-shortcut-manager 경로들>
검증: typecheck ✅ / JSON ✅ / (dev 확인 여부)
배포 여부: (했음 / 안 했음)
```
