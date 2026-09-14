#!/bin/zsh
# @svc-name: 업무 현황보기
# @svc-hotkey: Alt+9
# @svc-description: 지금 뭐가 얼마나 밀렸는지 궁금할 때 누르세요. 대기·진행중·오늘 완료 개수는 물론, 진행중인 일마다 이름과 경과 시간까지 보여줘요.

# 순수 조회 + 요약 문자열 조립까지는 osascript가 담당하고, 화면에 보여주는
# 건 그 결과를 받아 "$HACKMAC_POPUP"이 담당한다.
summary=$(osascript <<'APPLESCRIPT'
try
  set waitingCount to 0
  set ongoingCount to 0
  set doneTodayCount to 0
  set detailLines to {}
  set todayStart to (current date) - (time of (current date))

  tell application "Reminders"
    repeat with l in lists
      if (name of l) starts with "GTD " then
        set nms to name of every reminder of l
        set cds to completed of every reminder of l
        set dds to due date of every reminder of l
        set eds to completion date of every reminder of l
        repeat with i from 1 to (count of nms)
          if (item i of cds) is false then
            if (item i of dds) is missing value then
              set waitingCount to waitingCount + 1
            else
              set ongoingCount to ongoingCount + 1
              set diffSec to (current date) - (item i of dds)
              set h to diffSec div 3600
              set m to (diffSec mod 3600) div 60
              if h > 0 then
                set dur to (h as string) & "시간 " & (m as string) & "분째"
              else
                set dur to (m as string) & "분째"
              end if
              set end of detailLines to ("· " & (item i of nms) & " (" & dur & ")")
            end if
          else
            set ed to item i of eds
            if ed is not missing value and ed ≥ todayStart then
              set doneTodayCount to doneTodayCount + 1
            end if
          end if
        end repeat
      end if
    end repeat
  end tell

  log "Reminders 조회 완료: 진행중 " & ongoingCount & "개, 완료 " & doneTodayCount & "개, 대기 " & waitingCount & "개"

  set summary to "진행중 " & ongoingCount & "개 · 완료 " & doneTodayCount & "개 · 대기 " & waitingCount & "개"

  if ongoingCount > 0 then
    set AppleScript's text item delimiters to linefeed
    set detailText to detailLines as string
    set AppleScript's text item delimiters to ""
    set summary to summary & linefeed & linefeed & detailText
  end if

  return summary
on error errText number errNum
  log errText
  display notification errText with title "⚠️ 업무 현황보기 실패"
  return ""
end try
APPLESCRIPT
)

if [[ -n "$summary" ]]; then
  "$HACKMAC_POPUP" confirm --title "📊 업무 현황" --prompt "$summary" --ok "확인" --cancel "" > /dev/null
fi
