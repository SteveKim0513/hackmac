#!/bin/zsh
# @svc-name: 업무 시작
# @svc-hotkey: Alt+2
# @svc-description: 지금 손댈 일이 정해지면 누르세요. 등록해둔 일 중 하나를 고르면 그 순간부터 소요시간이 재기 시작해요. 여러 번 눌러 여러 건을 동시에 진행중으로 둘 수 있어요.

# 1. 대기중(마감일 없음)·진행중(마감일 있음 = 시작 표시) 리마인더를 조회 —
# 시작 표시는 마감일 필드에 "시작 시각"을 심어두는 식으로 구현했다(완료
# 처리 시점에 완료 시각 - 이 값으로 소요시간을 계산). 순수 조회라 osascript를
# 그대로 쓴다.
queryOut=$(osascript <<'APPLESCRIPT'
set waitingNames to {}
set ongoingCount to 0
tell application "Reminders"
  repeat with l in lists
    if (name of l) starts with "GTD " then
      set nms to name of every reminder of l
      set cds to completed of every reminder of l
      set dds to due date of every reminder of l
      repeat with i from 1 to (count of nms)
        if (item i of cds) is false then
          if (item i of dds) is missing value then
            set end of waitingNames to (item i of nms)
          else
            set ongoingCount to ongoingCount + 1
          end if
        end if
      end repeat
    end if
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return (ongoingCount as text) & linefeed & (waitingNames as text)
APPLESCRIPT
)
ongoingCount=$(echo "$queryOut" | head -n1)
waitingNamesRaw=$(echo "$queryOut" | tail -n +2)
if [[ -n "$waitingNamesRaw" ]]; then
  waitingNames=("${(@f)waitingNamesRaw}")
else
  waitingNames=()
fi
echo "Reminders 조회 완료: 대기 ${#waitingNames[@]}개, 진행중 ${ongoingCount}개"

if (( ${#waitingNames[@]} == 0 )); then
  osascript -e 'display notification "아직 등록한 일이 없어요 — 업무 등록으로 먼저 담아보세요" with title "📋 시작할 일 없음"'
  exit 0
fi

# 2. 이미 3개 이상 진행중이면 한 번 더 확인.
if (( ongoingCount >= 3 )); then
  "$HACKMAC_POPUP" confirm --title "업무 시작" --prompt "지금 ${ongoingCount}개 진행중이에요. 하나 더 시작할까요?" --ok "시작" --cancel "취소" > /dev/null
  if [[ $? -ne 0 ]]; then
    exit 0
  fi
fi

# 3. 시작할 일 고르기.
chosenName=$("$HACKMAC_POPUP" select --title "업무 시작" --prompt "무엇을 시작할까요?" --ok "시작" --cancel "취소" -- "${waitingNames[@]}")
if [[ $? -ne 0 ]]; then
  exit 0
fi
echo "선택 완료: $chosenName"

# 4. 시작 처리 — 값은 인자로 넘긴다.
osascript - "$chosenName" <<'APPLESCRIPT'
on run argv
  set chosenName to item 1 of argv
  try
    tell application "Reminders"
      repeat with l in lists
        if (name of l) starts with "GTD " then
          set matches to (every reminder of l whose name is chosenName and completed is false)
          if (count of matches) > 0 then
            set due date of (item 1 of matches) to (current date)
            exit repeat
          end if
        end if
      end repeat
    end tell
    log "시작 처리 완료"
    display notification chosenName with title "▶️ 시작했어요"
  on error errText number errNum
    if errNum is not -128 then
      log errText
      display notification errText with title "⚠️ 업무 시작 실패"
    end if
  end try
end run
APPLESCRIPT
