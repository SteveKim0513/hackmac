# v2 확인 필요 항목 조사 결과 (2026-11-06)

[hackmac-v2-plan.md](hackmac-v2-plan.md) 14절의 항목 1·2·3·4를 문서 조사와 로컬 CLI(`claude 2.1.318`, `codex-cli 0.164.0`) 실측으로 확인한 결과. 각 항목 끝에 **[결정]**과 아직 실제로 돌려 봐야 아는 **[스파이크]**를 적었다. 출처는 공식(code.claude.com, learn.chatgpt.com ← developers.openai.com/codex 리다이렉트, github.com/openai/codex, electronjs.org, developer.apple.com)만 썼다.

색인: [1. CLI 설치](#1-cli-설치) · [2. 로그인](#2-로그인) · [3. Codex 대화 엔진](#3-codex-대화-엔진) · [4. 상주 프로세스](#4-상주-프로세스) · [5. 남은 스파이크](#5-남은-스파이크)

## 1. CLI 설치

**[결정] 두 CLI 모두 공식 독립 설치 스크립트를 앱이 자식 프로세스로 실행한다.** npm·Homebrew는 쓰지 않는다. 설치 뒤 앱은 PATH에 기대지 않고 `~/.local/bin/claude`, `~/.local/bin/codex` 절대경로로 부른다.

| | Claude Code | Codex |
|---|---|---|
| 명령 | `curl -fsSL https://claude.ai/install.sh \| bash -s stable` | `CODEX_NON_INTERACTIVE=1 sh -c 'curl -fsSL https://chatgpt.com/codex/install.sh \| sh'` |
| 설치 위치 | 런처 `~/.local/bin/claude` → `~/.local/share/claude/versions/<ver>` | 런처 `~/.local/bin/codex`, 본체 `~/.codex/packages/standalone/` |
| sudo | 불필요. 설치기가 sudo 실행을 거부 | 불필요(전부 `$HOME` 아래) |
| Node | 불필요(네이티브 바이너리) | 불필요 |
| 무결성 | manifest SHA256 + GPG 서명 + Apple 공증 | SHA256SUMS |
| 자동 업데이트 | 백그라운드 자동(공식). `autoUpdatesChannel: "stable"` | 문서 없음(모름). 앱이 주기적으로 `codex update` 호출 |
| PATH 건드림 | 안 함 | `.zshrc`에 PATH 블록 추가(무해하나 사용자 파일을 건드림) |
| 앱 전용 폴더 설치 | 불가(런처 경로 고정, 옮기면 자동 업데이트 품질 저하) | `CODEX_INSTALL_DIR`로 가능하나 한쪽만 옮기면 일관성 없음 → 기본 위치 유지 |
| 최소 macOS | 13.0+, arm64·x64 | 12+, arm64·x64 |

## 2. 로그인

- **Claude는 디바이스 코드 로그인이 없다.** `claude auth login`은 브라우저를 열고, 브라우저가 보여 주는 코드를 터미널 stdin에 붙여넣는 방식. 앱은 URL을 `shell.openExternal`로 열고, 사용자가 받은 코드를 앱 화면에서 입력받아 `claude auth login`의 stdin에 넣는다. 유료 플랜(Pro/Max/Team/Enterprise) 또는 Console 계정 필요.
- **Codex `codex login --device-auth`는 공식(베타)이지만** 사용자가 ChatGPT 보안 설정에서 미리 켜야 하고, 안 켜져 있으면 브라우저 로그인으로 조용히 떨어진다. 기본은 브라우저 + `localhost:1455` 콜백.
- 상태 확인: `claude auth status`(기본 JSON: `loggedIn, authMethod, email, subscriptionType, configDirectory, loginExpiresAt`, exit 0/1). `codex login status`는 JSON 없음 — stderr 한 줄(`Logged in using ChatGPT` 등) + exit 0/1.
- 자격증명 위치: Claude는 macOS Keychain(폴백 `~/.claude/.credentials.json`), `CLAUDE_CONFIG_DIR`로 계정 분리 가능(공식). Codex는 평문 `~/.codex/auth.json`(기본), `cli_auth_credentials_store = "keyring"`으로 Keychain 가능, `CODEX_HOME`으로 분리(폴더가 미리 있어야 함).

**[결정]** 계정 모듈은 스튜디오 `login.ts`를 그대로 가져오되, Claude 로그인 화면에 "코드 붙여넣기" 입력을 둔다.

## 3. Codex 대화 엔진

**[결정] `codex app-server --listen stdio://`(JSON-RPC 2.0, JSONL)로 붙인다.** `codex exec --json`은 프로세스 하나 = 턴 하나이고 텍스트 델타가 없어 타자 효과를 못 낸다. `codex mcp-server`는 삭제됐다. TS SDK는 `exec`의 래퍼라 같은 한계. app-server는 "Experimental" 표시지만 OpenAI의 VS Code 확장과 Python SDK(stable)가 이 프로토콜 위에서 돈다. 로컬 0.164.0에서 `initialize` 핸드셰이크 즉시 응답 확인.

Claude 어댑터와 다른 점(대화 모듈의 어댑터 인터페이스가 흡수해야 하는 것):

| | Claude `-p stream-json` | Codex `app-server` |
|---|---|---|
| 시작 | spawn → `system/init`에 session_id | spawn → `initialize` 요청 → `initialized` 알림 → `thread/start` 또는 `thread/resume` |
| 세션 | session uuid, `--resume`을 프로세스 인자로 | thread. 한 프로세스가 여러 thread. 복구는 `thread/resume` 요청 |
| 메시지 보내기 | stdin에 `{"type":"user",...}` 한 줄 | `turn/start{threadId,input}` 요청(응답이 ack). 진행 중엔 `turn/steer` |
| 텍스트 스트림 | `stream_event` 안의 `text_delta` | `item/agentMessage/delta`. `phase: commentary\|partial_answer\|final_answer` 구분 필요 |
| 턴 끝 | `result{is_error, usage, total_cost_usd}` | `turn/completed{status}`. USD 없음, 토큰은 `thread/tokenUsage/updated` |
| 승인 | `--permission-mode dontAsk`, 거부는 통보만 | `approvalPolicy:"never"`로 대부분 안 묻지만 오는 `*/requestApproval`은 **반드시 응답**(미응답 = 턴 멈춤) → `decline` 자동 응답 |
| 샌드박스 | 설정 `sandbox.*`(기본 꺼짐, Bash만) | `sandbox:"workspace-write"`가 thread/turn 파라미터. cwd+`/tmp` 외 쓰기와 네트워크를 Seatbelt로 차단 |
| 한도 | `rate_limit_event` | `account/rateLimits/updated{usedPercent, resetsAt}` |
| 중단 | SIGINT | `turn/interrupt` |

Claude 쪽 변경 확인: 스튜디오 `engine.ts`의 플래그 조합은 모두 현행 공식. v2.1.302부터 `-p` 기본 권한 모드가 Manual(명시 안 하면 거부) — `dontAsk` 명시로 영향 없음. `--permission-prompts none`, `--bare`(OAuth 안 읽음, 쓰면 안 됨), `--restricted`가 새로 있음. 샌드박스는 CLI 플래그가 아니라 설정(`sandbox.enabled`, `permissions.blockWritesOutsideWorkingDirectories` 등), 1회성은 `--settings '{"sandbox":{...}}'`.

**[스파이크 → 해결 2026-11-06]** 0.164.0에서 스키마를 뽑고 실제 한 턴을 돌려 확인했다.
- `turn/start` 응답: `{turn:{id, status:"inProgress", items:[]}}`. 같은 번호가 `turn/started` 알림으로도 온다.
- **phase는 delta가 아니라 항목에 붙는다**: `item/started{item:{type:"agentMessage", id, phase:"final_answer"|"commentary"}}` 뒤에 `item/agentMessage/delta{itemId, delta}`. 어댑터가 itemId별 phase를 기억한다.
- `turn/completed{turn:{status:"completed"|"interrupted"|"failed", items, error:{message}|null}}`. 최종 답은 items의 agentMessage(commentary 제외) text.
- 한도: `account/rateLimits/updated{rateLimits:{primary:{usedPercent, windowDurationMins:300, resetsAt(초)}, secondary:{… 10080 …}}}`.
- 승인 응답 모양: commandExecution·fileChange → `{decision:"decline"}`, 옛 applyPatch/execCommand → `{decision:"denied"}`, permissions → `{permissions:{}, scope:"turn"}`, requestUserInput → `{answers:{}}`, elicitation → `{action:"decline"}`, tool/call → `{contentItems:[], success:false}`.
- 사용자의 `~/.codex/config.toml`에 있는 MCP 서버가 thread마다 같이 뜬다(이 Mac: codex_apps, cua_repl). 지금은 그대로 둔다. 앱 제작이 사용자 MCP에 기대지 않게 할지 4단계에서 정한다.
- 남은 것: 오래 띄운 app-server의 메모리 안정성.

## 4. 상주 프로세스

**[결정] SMAppService `agentService` + 번들 안 plist.** `Contents/Library/LaunchAgents/co.imaginefutures.hackmac.resident.plist`에 `BundleProgram: Contents/MacOS/HackMac`, `ProgramArguments: [..., --role=resident]`, `KeepAlive: {SuccessfulExit: false}`, `ProcessType: Interactive`, `EnvironmentVariables.PATH`. Electron 33은 `app.setLoginItemSettings({openAtLogin:true, type:'agentService', serviceName:'<plist 이름>'})`가 내부에서 SMAppService를 직접 호출한다(네이티브 모듈 불필요, macOS 13+). `getLoginItemSettings(...).status === 'requires-approval'`로 사용자가 끈 것을 감지. plist는 electron-builder `extraFiles: {from:'build/launchd', to:'Library/LaunchAgents'}`로 서명 전에 번들에 넣는다.

폴백(스튜디오 `launchd.ts` 방식, `~/Library/LaunchAgents`)은 `AssociatedBundleIdentifiers: co.imaginefutures.hackmac`를 넣어야 로그인 항목에 "HackMac"으로 뜬다(없으면 서명 조직명). 두 방식을 같이 쓰면 한쪽을 지워도 계속 뜨는 보고가 있어 하나만 쓴다.

프로세스 분리:
- **상주(실행 서버) = Electron 메인.** Tray·globalShortcut·Notification·BrowserWindow는 메인 전용이라 `utilityProcess`에 둘 수 없다.
- **작업실 = 같은 바이너리를 `--role=studio`로 spawn.** 상주가 `requestSingleInstanceLock`을 잡으면 사용자가 Finder에서 앱을 열 때 `second-instance`가 상주로 오고, 거기서 작업실을 띄운다. 락은 userData 기준이라 역할별로 userData를 나누거나 작업실은 락을 안 잡는다.
- **엔진 지기 = 상주 메인의 `utilityProcess`**(창 없는 Node 작업에 맞음).
- `wasOpenedAtLogin`은 launchd가 바이너리를 직접 exec하면 false가 된다(Apple Event가 없음) → 역할 인자로 대체.
- launchd 기본 환경에 PATH가 없다(실측: `SSH_AUTH_SOCK`뿐). 스크립트가 쓸 PATH를 plist나 실행기에서 구성.
- launchd는 잡이 죽으면 같은 프로세스 그룹을 죽인다. 실행기가 스크립트를 `detached`로 띄우므로 `AbandonProcessGroup` 결정 필요.
- `ProcessType` 미지정이면 CPU·I/O가 제한된다 → `Interactive`. v1의 `powerSaveBlocker`와 중복 여부는 스파이크.

권한 승인 창 이름: TCC는 책임 프로세스(responsible process)의 이름을 쓴다. launchd가 번들 안 `HackMac` 바이너리를 직접 띄우면 HackMac이 책임 프로세스이고 `zsh → osascript` 자식은 이를 상속해 "HackMac"으로 뜬다(DTS 답변 + v1 동작과 일치, launchd 경로는 실측 필요). `NSAppleEventsUsageDescription`은 상주 번들 Info.plist에 있어야 한다.

## 4.5 제작 에이전트 격리 실측 (계획서 10.1)

에이전트는 승인 없이 돌되 작업 폴더 밖에 쓰지 못해야 한다. claude 2.1.318·codex 0.164.0으로 같은 다섯 동작을 시켜 봤다.

| 동작 | Claude 샌드박스 + `Write`·`Edit` 무제한 | Claude 샌드박스 + `Write(./**)`·`Edit(./**)` | Codex `workspace-write` |
|---|---|---|---|
| 작업 폴더 안 파일 도구 쓰기 | 됨 | 됨(작업 폴더가 실제 경로일 때만) | — |
| **홈에 파일 도구 쓰기** | **됨(샌드박스를 안 거침)** | 거부 | — |
| 홈에 셸 쓰기 | 막힘(operation not permitted) | 막힘 | 막힘 |
| 작업 폴더 안 셸 쓰기 | 됨 | 됨 | 됨 |
| 셸에서 Electron을 Node로 돌려 작업 폴더에 쓰기 | 됨 | 됨 | 됨 |

**[결정]**
- Claude: `--settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true,"allowUnsandboxedCommands":false}}'` + `--allowedTools Bash,Read,Glob,Grep,Edit(./**),Write(./**),WebFetch,WebSearch` + `dontAsk`. **샌드박스는 셸만 막는다** — 파일 도구 범위는 권한 규칙으로 따로 좁혀야 한다(`modules/build/agent.ts`).
- 작업 폴더는 `realpath`로 넘긴다. `/var/folders/…`(→ `/private/var/…` 링크) 아래에서는 `Write(./**)`가 작업 폴더 안 쓰기까지 막았다.
- Codex: thread `sandbox: workspace-write`만으로 충분. 엔진에 준 환경변수(`HACKMAC_*`)가 셸까지 간다.
- 에이전트 ↔ HackMac 통로는 소켓이 아니라 작업 폴더 안 파일(`.hackmac/inbox`·`outbox`). 두 샌드박스 모두에서 된다(`modules/build/inbox.ts`).
- 남은 것: Claude 샌드박스 셸의 네트워크는 막혀 있다(개발 중 curl로 API를 시험하지 못함). 검증 게이트의 시험은 HackMac이 샌드박스 밖에서 돌려 네트워크가 된다. 개발 중 네트워크가 필요한지 실제 앱을 만들며 본다.

## 5. 남은 스파이크

실제 서명 빌드로 돌려 봐야 아는 것. 첫 패키지 빌드 때 한 번에 확인한다.

1. SMAppService agent의 `KeepAlive`가 `kill -9` 뒤 실제로 재시작하는지, 코드 0 종료는 재시작 안 하는지.
2. `setLoginItemSettings({type:'agentService'})`가 서명·공증 앱에서 `enabled`를 돌려주고 로그인 항목에 "HackMac"으로 뜨는지. `/Applications` 복사만으로 목록에 안 뜨는 보고 있음.
3. launchd가 exec한 HackMac에서 Tray·globalShortcut·Notification·`app.dock.show()`가 되는지.
4. 권한 프롬프트가 "HackMac" 이름으로 뜨고 HackMac 항목에 저장되는지.
5. `--role=studio` 두 번째 실행 때 단일 인스턴스 락·Dock·Cmd-Tab 동작.
6. ~~Codex app-server 스키마 고정(3절).~~ 해결(3절).
7. electron-updater가 번들을 교체한 뒤 launchd가 새 바이너리로 재시작하는지.
