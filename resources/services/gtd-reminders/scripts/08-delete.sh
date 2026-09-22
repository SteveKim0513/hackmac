#!/bin/zsh
# @svc-name: 업무 삭제
# @svc-hotkey: Alt+4
# @svc-description: 더 이상 필요 없는 일을 등록했을 때 누르세요. 대기중이거나 진행중인 일 중 하나를 골라 지울 수 있어요. 완료한 일은 기록 보존을 위해 대상에서 빠져요.

# 1. 대기중(마감일 없음)·진행중(마감일 있음 = 시작 표시) 리마인더를 조회 —
# 완료된 항목은 공유 기록(05-share.sh) 보존을 위해 대상에서 제외한다. 순수
# 조회라 osascript를 그대로 쓴다.
queryOut=$(osascript <<'APPLESCRIPT'
set entries to {}
set RS to (ASCII character 31)
tell application "Reminders"
  repeat with l in lists
    if (name of l) starts with "GTD " then
      if (name of l) starts with "GTD 개인 " then
        set cat to "개인"
      else
        set cat to "업무"
      end if
      set nms to name of every reminder of l
      set cds to completed of every reminder of l
      set dds to due date of every reminder of l
      repeat with i from 1 to (count of nms)
        if (item i of cds) is false then
          set nm to item i of nms
          if (item i of dds) is missing value then
            set end of entries to (cat & RS & "[대기] " & nm)
          else
            set diffSec to (current date) - (item i of dds)
            set h to diffSec div 3600
            set m to (diffSec mod 3600) div 60
            if h > 0 then
              set dur to (h as string) & "시간 " & (m as string) & "분째"
            else
              set dur to (m as string) & "분째"
            end if
            set end of entries to (cat & RS & "[진행중 " & dur & "] " & nm)
          end if
        end if
      end repeat
    end if
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return entries as text
APPLESCRIPT
)
if [[ -n "$queryOut" ]]; then
  rawEntries=("${(@f)queryOut}")
else
  rawEntries=()
fi
# 업무를 먼저, 개인을 뒤에 두어 구간 헤더가 섞이지 않게 한다.
entries=()
personalEntries=()
for entry in "${rawEntries[@]}"; do
  if [[ "$entry" == 개인$'\x1f'* ]]; then
    personalEntries+=("$entry")
  else
    entries+=("$entry")
  fi
done
entries+=("${personalEntries[@]}")
echo "Reminders 조회 완료: 삭제 대상 ${#entries[@]}개"

if (( ${#entries[@]} == 0 )); then
  osascript -e 'display notification "지울 일이 없어요 — 완료한 일은 기록 보존을 위해 삭제 대상에서 빠져요" with title "📋 삭제할 일 없음"'
  exit 0
fi

# 2. 삭제할 일 고르기 — 상태([대기]/[진행중])를 라벨에 붙여서 실수로
# 진행중인 일을 지우지 않도록 한다.
chosenEntry=$("$HACKMAC_POPUP" select --title "업무 삭제" --prompt "무엇을 지울까요?" --ok "삭제" --cancel "취소" -- "${entries[@]}")
if [[ $? -ne 0 ]]; then
  exit 0
fi
echo "선택 완료: $chosenEntry"

# 2-1. 실제 리마인더 이름은 라벨의 "] " 뒤쪽이다.
chosenName="${chosenEntry#*] }"

# 2-2. 삭제는 되돌리기 어려운 조작이라, 고른 이름을 그대로 되비쳐 보여주고
# 한 번 더 확인받는다 — 02-start.sh/03-complete.sh와 같은 안전장치 패턴.
"$HACKMAC_POPUP" confirm --title "업무 삭제" --prompt "'${chosenName}'을 삭제할까요? 되돌리기 어려울 수 있어요" --ok "삭제" --cancel "취소" > /dev/null
if [[ $? -ne 0 ]]; then
  exit 0
fi

# 3. 삭제 처리 — 값은 인자로 넘긴다.
osascript - "$chosenName" <<'APPLESCRIPT'
on run argv
  set chosenName to item 1 of argv
  try
    tell application "Reminders"
      repeat with l in lists
        if (name of l) starts with "GTD " then
          set matches to (every reminder of l whose name is chosenName and completed is false)
          if (count of matches) > 0 then
            delete (item 1 of matches)
            exit repeat
          end if
        end if
      end repeat
    end tell
    log "삭제 처리 완료"
    display notification chosenName with title "🗑 삭제했어요"
  on error errText number errNum
    if errNum is not -128 then
      log errText
      display notification errText with title "⚠️ 업무 삭제 실패"
    end if
  end try
end run
APPLESCRIPT
