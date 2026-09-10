#!/bin/zsh
# @svc-name: 업무 공유하기
# @svc-hotkey: Alt+5
# @svc-description: 하루를 정리하며 팀에 남길 때 누르세요. 오늘 완료·진행중·대기 현황을 소요시간과 함께 클립보드에 복사해요. 채널에 붙여넣기(⌘V)만 하면 끝이에요.

osascript <<'APPLESCRIPT'
-- Slack Incoming Webhook을 쓰고 싶으면 아래에 URL을 넣으세요. 비워두면
-- 클립보드 복사만 하고 끝난다.
property slackWebhookURL : ""

on fmtDur(sec)
  set h to sec div 3600
  set m to (sec mod 3600) div 60
  if h > 0 then
    return (h as string) & "시간 " & (m as string) & "분"
  else
    return (m as string) & "분"
  end if
end fmtDur

on jsonEscapedString(txt)
  set out to ""
  repeat with ch in (every character of txt)
    if ch as string is "\"" then
      set out to out & "\\\""
    else if ch as string is "\\" then
      set out to out & "\\\\"
    else if ch as string is linefeed then
      set out to out & "\\n"
    else
      set out to out & ch
    end if
  end repeat
  return "\"" & out & "\""
end jsonEscapedString

on todayLabel()
  set d to current date
  set wd to weekday of d
  if wd is Sunday then
    set dowKr to "일"
  else if wd is Monday then
    set dowKr to "월"
  else if wd is Tuesday then
    set dowKr to "화"
  else if wd is Wednesday then
    set dowKr to "수"
  else if wd is Thursday then
    set dowKr to "목"
  else if wd is Friday then
    set dowKr to "금"
  else
    set dowKr to "토"
  end if
  return ((month of d as integer) as string) & "/" & ((day of d) as string) & "(" & dowKr & ")"
end todayLabel

try
  set todayStart to (current date) - (time of (current date))
  set doneLines to {}
  set ongoingLines to {}
  set waitingLines to {}

  tell application "Reminders"
    repeat with l in lists
      if (name of l) starts with "GTD " then
        set nms to name of every reminder of l
        set cds to completed of every reminder of l
        set dds to due date of every reminder of l
        set eds to completion date of every reminder of l
        repeat with i from 1 to (count of nms)
          set nm to item i of nms
          if (item i of cds) is true then
            set ed to item i of eds
            if ed is not missing value and ed ≥ todayStart then
              set sd to item i of dds
              if sd is missing value then
                set dsec to 0
              else
                set dsec to ed - sd
              end if
              set end of doneLines to ("- " & nm & " (" & my fmtDur(dsec) & ")")
            end if
          else
            set sd to item i of dds
            if sd is missing value then
              set end of waitingLines to ("- " & nm)
            else
              set dsec to (current date) - sd
              set end of ongoingLines to ("- " & nm & " (" & my fmtDur(dsec) & "째)")
            end if
          end if
        end repeat
      end if
    end repeat
  end tell

  set AppleScript's text item delimiters to linefeed
  set doneText to doneLines as string
  set ongoingText to ongoingLines as string
  set waitingText to waitingLines as string
  set AppleScript's text item delimiters to ""

  set report to "📅 " & (my todayLabel()) & " 진행 현황" & linefeed & ¬
    "✅ 완료 " & (count of doneLines) & linefeed & doneText & linefeed & ¬
    "🌀 진행중 " & (count of ongoingLines) & linefeed & ongoingText & linefeed & ¬
    "🗂 대기 " & (count of waitingLines) & linefeed & waitingText

  set the clipboard to report

  if slackWebhookURL is not "" then
    set payload to "{\"text\":" & (my jsonEscapedString(report)) & "}"
    do shell script "curl -s -X POST -H " & (quoted form of "Content-Type: application/json") & " -d " & (quoted form of payload) & " " & (quoted form of slackWebhookURL)
    display notification "오늘 진행 현황을 클립보드에 복사하고 Slack에도 올렸어요" with title "📤 공유했어요"
  else
    display notification "오늘 진행 현황을 클립보드에 복사했어요 — 팀 채널에 붙여넣기(⌘V)만 하면 돼요" with title "📤 공유했어요"
  end if
on error errText number errNum
  if errNum is not -128 then
    log errText
    display notification errText with title "⚠️ 업무 공유 실패"
  end if
end try
APPLESCRIPT
