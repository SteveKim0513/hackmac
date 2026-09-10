#!/bin/zsh
# @svc-name: 업무 현황보기
# @svc-hotkey: Alt+4
# @svc-description: 지금 뭐가 얼마나 밀렸는지 궁금할 때 누르세요. 대기·진행중·오늘 완료 개수를 한눈에 보여줘요.

osascript <<'APPLESCRIPT'
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

  set summary to "진행중 " & ongoingCount & "개 · 완료 " & doneTodayCount & "개 · 대기 " & waitingCount & "개"

  if ongoingCount > 0 and ongoingCount ≤ 3 then
    set AppleScript's text item delimiters to linefeed
    set detailText to detailLines as string
    set AppleScript's text item delimiters to ""
    set summary to summary & linefeed & linefeed & detailText
  end if

  activate
  display dialog summary with title "📊 업무 현황" buttons {"확인"} default button "확인" with icon note
on error errText number errNum
  if errNum is not -128 then
    log errText
    display notification errText with title "⚠️ 업무 현황보기 실패"
  end if
end try
APPLESCRIPT
