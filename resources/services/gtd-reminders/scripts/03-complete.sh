#!/bin/zsh
# @svc-name: 업무 완료
# @svc-hotkey: Alt+3
# @svc-description: 일이 끝나면 누르세요. 진행중인 일 중 하나를 골라 닫으면, 시작(업무 시작)한 뒤로 걸린 시간이 자동으로 남아요.

# 1. 진행중(마감일 있음 = 시작 표시)인 리마인더 이름 조회 — 순수 조회라
# osascript를 그대로 쓴다.
ongoingNamesRaw=$(osascript <<'APPLESCRIPT'
set ongoingNames to {}
tell application "Reminders"
  repeat with l in lists
    if (name of l) starts with "GTD " then
      set nms to name of every reminder of l
      set cds to completed of every reminder of l
      set dds to due date of every reminder of l
      repeat with i from 1 to (count of nms)
        if (item i of cds) is false and (item i of dds) is not missing value then
          set end of ongoingNames to (item i of nms)
        end if
      end repeat
    end if
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return ongoingNames as text
APPLESCRIPT
)
if [[ -n "$ongoingNamesRaw" ]]; then
  ongoingNames=("${(@f)ongoingNamesRaw}")
else
  ongoingNames=()
fi
echo "Reminders 조회 완료: 진행중 ${#ongoingNames[@]}개"

if (( ${#ongoingNames[@]} == 0 )); then
  osascript -e 'display notification "아직 시작한 일이 없어요 — 업무 시작으로 먼저 시작해보세요" with title "📋 완료할 일 없음"'
  exit 0
fi

# 2. 완료할 일 고르기.
chosenName=$("$HACKMAC_POPUP" select --title "업무 완료" --prompt "무엇을 완료할까요?" --ok "완료" --cancel "취소" -- "${ongoingNames[@]}")
if [[ $? -ne 0 ]]; then
  exit 0
fi
echo "선택 완료: $chosenName"

# 3. 완료 처리 — 값은 인자로 넘긴다.
osascript - "$chosenName" <<'APPLESCRIPT'
on run argv
  set chosenName to item 1 of argv
  try
    set diffSec to 0
    tell application "Reminders"
      repeat with l in lists
        if (name of l) starts with "GTD " then
          set matches to (every reminder of l whose name is chosenName and completed is false)
          if (count of matches) > 0 then
            set r to item 1 of matches
            set startD to due date of r
            set completed of r to true
            set diffSec to (completion date of r) - startD
            exit repeat
          end if
        end if
      end repeat
    end tell

    log "완료 처리 완료"
    set h to diffSec div 3600
    set m to (diffSec mod 3600) div 60
    if h > 0 then
      set dur to (h as string) & "시간 " & (m as string) & "분"
    else
      set dur to (m as string) & "분"
    end if

    display notification (chosenName & " (" & dur & ")") with title "✅ 완료했어요"
  on error errText number errNum
    if errNum is not -128 then
      log errText
      display notification errText with title "⚠️ 업무 완료 실패"
    end if
  end try
end run
APPLESCRIPT
