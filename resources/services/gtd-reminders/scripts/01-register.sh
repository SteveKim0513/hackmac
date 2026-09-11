#!/bin/zsh
# @svc-name: 업무 등록
# @svc-hotkey: Alt+1
# @svc-description: 할 일이 떠올랐을 때 누르세요. 프로젝트가 여러 개면 어디에 넣을지 고르고, 없으면 수집함으로 바로 들어가요.

INBOX="GTD 수집함"

# 1. 제목 입력 — 팝업은 HackMac 앱이 그린다("$HACKMAC_POPUP", CLAUDE.md "서비스
# 설계 원칙" 참고). 취소(Esc/취소 버튼)는 종료 코드 1로 돌아온다.
theTitle=$("$HACKMAC_POPUP" prompt --title "업무 등록" --prompt "무엇을 할까요?" --ok "등록" --cancel "취소")
if [[ $? -ne 0 || -z "$theTitle" ]]; then
  exit 0
fi
echo "제목 입력 완료: $theTitle"

# 2. 수집함이 없으면 만들고, GTD 프로젝트 리스트 이름을 조회 — 다이얼로그가
# 없는 순수 조회라 osascript를 그대로 쓴다.
projectNamesRaw=$(osascript <<APPLESCRIPT
tell application "Reminders"
  if not (exists list "$INBOX") then make new list with properties {name:"$INBOX"}
  set out to {}
  repeat with l in lists
    if (name of l) starts with "GTD " then set end of out to (name of l)
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
APPLESCRIPT
)
if [[ -n "$projectNamesRaw" ]]; then
  projectNames=("${(@f)projectNamesRaw}")
else
  projectNames=()
fi
echo "프로젝트 목록 조회 완료: ${#projectNames[@]}개"

# 3. 프로젝트가 여러 개일 때만 고르게 한다 — 취소(건너뛰기)하면 수집함 그대로.
targetList="$INBOX"
if (( ${#projectNames[@]} > 1 )); then
  picked=$("$HACKMAC_POPUP" select --title "업무 등록" --prompt "어디에 등록할까요?" --ok "선택" --cancel "건너뛰기(수집함)" --default "$INBOX" -- "${projectNames[@]}")
  if [[ $? -eq 0 && -n "$picked" ]]; then
    targetList="$picked"
  fi
fi

# 4. 실제 등록 — 값은 인자로 넘긴다(`osascript - "$1" ... <<'EOF'`처럼 `-`를
# 붙여야 인자가 stdin 스크립트 대신 파일 경로로 오인되지 않는다).
osascript - "$theTitle" "$targetList" <<'APPLESCRIPT'
on run argv
  set theTitle to item 1 of argv
  set targetList to item 2 of argv
  try
    tell application "Reminders"
      tell list targetList
        make new reminder with properties {name:theTitle}
      end tell
    end tell
    log "리마인더 생성 완료"
    display notification theTitle with title ("📥 등록했어요 · " & targetList)
  on error errText number errNum
    if errNum is not -128 then
      log errText
      display notification errText with title "⚠️ 업무 등록 실패"
    end if
  end try
end run
APPLESCRIPT
