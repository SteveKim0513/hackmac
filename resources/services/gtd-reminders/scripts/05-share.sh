#!/bin/zsh
# @svc-name: 업무 공유하기
# @svc-hotkey: Alt+0
# @svc-description: 하루를 정리하며 팀에 남길 때 누르세요. 달력에서 날짜를 고르면 그 날짜에 완료한 업무 내역과 지금 진행중인 업무 현황이 함께 클립보드에 복사돼요(진행중은 날짜와 무관하게 항상 담겨요). 개인 프로젝트는 공유 대상에서 빠지고 업무만 담겨요. 채널에 붙여넣기(⌘V)만 하면 끝이에요.

# 1. 완료한 업무가 있는 날짜를 모아 달력에 점으로 표시할 수 있게 한다 —
# 순수 조회(날짜별 whose 필터가 아니라 completion date 배열 통째 읽기)라
# osascript를 그대로 쓴다.
markedDatesRaw=$(osascript <<'APPLESCRIPT'
set dateStrs to {}
tell application "Reminders"
  repeat with l in lists
    if (name of l) starts with "GTD " and not ((name of l) starts with "GTD 개인 ") then
      set cds to completed of every reminder of l
      set eds to completion date of every reminder of l
      repeat with i from 1 to (count of cds)
        if (item i of cds) is true then
          set ed to item i of eds
          if ed is not missing value then
            set mStr to ((month of ed as integer) as string)
            if (length of mStr) is 1 then set mStr to "0" & mStr
            set dStr to ((day of ed) as string)
            if (length of dStr) is 1 then set dStr to "0" & dStr
            set end of dateStrs to (((year of ed) as string) & "-" & mStr & "-" & dStr)
          end if
        end if
      end repeat
    end if
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return dateStrs as text
APPLESCRIPT
)
if [[ -n "$markedDatesRaw" ]]; then
  markedDates=("${(@f)$(printf '%s\n' "$markedDatesRaw" | sort -u)}")
else
  markedDates=()
fi
echo "완료 업무가 있는 날짜 ${#markedDates[@]}일 조회 완료"

# 2. 공유할 날짜 선택 — 팝업은 HackMac 앱이 그린다("$HACKMAC_POPUP", CLAUDE.md
# "서비스 설계 원칙" 참고). 기본값은 오늘.
todayIso=$(date +%F)
chosenIso=$("$HACKMAC_POPUP" date --title "업무 공유하기" --prompt "공유할 날짜를 선택하세요" --ok "선택" --cancel "취소" --default "$todayIso" -- "${markedDates[@]}")
if [[ $? -ne 0 || -z "$chosenIso" ]]; then
  exit 0
fi
echo "선택한 날짜: $chosenIso (오늘: $todayIso)"

chosenYear="${chosenIso%%-*}"
rest="${chosenIso#*-}"
chosenMonth="${rest%%-*}"
chosenDay="${rest##*-}"
isToday=0
[[ "$chosenIso" == "$todayIso" ]] && isToday=1

# 3. 선택한 날짜의 완료 내역(오늘이면 진행중·대기까지)을 조회해 클립보드에
# 담는다 — 값은 인자로 넘긴다("-" 없이 쓰면 "$1"을 파일 경로로 오인한다).
osascript - "$chosenYear" "$chosenMonth" "$chosenDay" "$isToday" <<'APPLESCRIPT'
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

on dowLabel(d)
  set wd to weekday of d
  if wd is Sunday then
    return "일"
  else if wd is Monday then
    return "월"
  else if wd is Tuesday then
    return "화"
  else if wd is Wednesday then
    return "수"
  else if wd is Thursday then
    return "목"
  else if wd is Friday then
    return "금"
  else
    return "토"
  end if
end dowLabel

on dateLabel(d)
  return ((month of d as integer) as string) & "/" & ((day of d) as string) & "(" & (my dowLabel(d)) & ")"
end dateLabel

on run argv
  set y to (item 1 of argv) as integer
  set m to (item 2 of argv) as integer
  set d to (item 3 of argv) as integer
  set isToday to (item 4 of argv) is "1"

  try
    -- day를 1로 먼저 낮춰두지 않으면(오늘이 31일인데 month만 먼저 바꾸는
    -- 경우 등) 일부 달에서 day 오버플로로 다음 달로 밀릴 수 있다.
    set dayStart to current date
    set time of dayStart to 0
    set day of dayStart to 1
    set year of dayStart to y
    set month of dayStart to m
    set day of dayStart to d
    set dayEnd to dayStart + 1 * days

    set doneLines to {}
    set ongoingLines to {}
    set waitingLines to {}

    tell application "Reminders"
      repeat with l in lists
        -- 개인 프로젝트는 공유 대상에서 뺀다 — 업무만 읽어 처리한다.
        if (name of l) starts with "GTD " and not ((name of l) starts with "GTD 개인 ") then
          set nms to name of every reminder of l
          set cds to completed of every reminder of l
          set dds to due date of every reminder of l
          set eds to completion date of every reminder of l
          set bds to body of every reminder of l
          repeat with i from 1 to (count of nms)
            set nm to item i of nms
            if (item i of cds) is true then
              set ed to item i of eds
              if ed is not missing value and ed ≥ dayStart and ed < dayEnd then
                set sd to item i of dds
                if sd is missing value then
                  set dsec to 0
                else
                  set dsec to ed - sd
                end if

                -- 03-complete.sh가 완료 시 남겨둔 "target="/"achievement="
                -- 줄이 있으면 목표 대비 달성률도 같이 보여준다.
                set theBody to item i of bds
                if theBody is missing value then set theBody to ""
                set targetMinutes to missing value
                set achievementPercent to missing value
                repeat with ln in paragraphs of theBody
                  if ln starts with "target=" then
                    try
                      set targetMinutes to (text 8 thru -1 of ln) as integer
                    end try
                  else if ln starts with "achievement=" then
                    set achievementPercent to (text 13 thru -1 of ln)
                  end if
                end repeat

                set durText to my fmtDur(dsec)
                if targetMinutes is not missing value and achievementPercent is not missing value then
                  set durText to durText & " · 목표 " & targetMinutes & "분 대비 " & achievementPercent
                end if

                set end of doneLines to ("- " & nm & " (" & durText & ")")
              end if
            else
              -- 진행중은 완료 여부와 달리 선택한 날짜에 묶인 개념이 아니라
              -- "지금" 스냅샷이라, 어떤 날짜를 고르든 항상 담는다. 대기는
              -- 기존처럼 오늘을 고른 경우에만 보여준다.
              set sd to item i of dds
              if sd is missing value then
                if isToday then set end of waitingLines to ("- " & nm)
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

    if isToday then
      set report to "📅 " & (my dateLabel(dayStart)) & " 진행 현황" & linefeed & ¬
        "✅ 완료 " & (count of doneLines) & linefeed & doneText & linefeed & ¬
        "🌀 진행중 " & (count of ongoingLines) & linefeed & ongoingText & linefeed & ¬
        "🗂 대기 " & (count of waitingLines) & linefeed & waitingText
    else
      set report to "📅 " & (my dateLabel(dayStart)) & " 업무 내역" & linefeed & ¬
        "✅ 완료 " & (count of doneLines) & linefeed & doneText & linefeed & ¬
        "🌀 진행중 " & (count of ongoingLines) & linefeed & ongoingText
    end if

    set the clipboard to report

    if slackWebhookURL is not "" then
      set payload to "{\"text\":" & (my jsonEscapedString(report)) & "}"
      do shell script "curl -s -X POST -H " & (quoted form of "Content-Type: application/json") & " -d " & (quoted form of payload) & " " & (quoted form of slackWebhookURL)
      display notification "선택한 날짜의 업무 내역을 클립보드에 복사하고 Slack에도 올렸어요" with title "📤 공유했어요"
    else
      display notification "선택한 날짜의 업무 내역을 클립보드에 복사했어요 — 팀 채널에 붙여넣기(⌘V)만 하면 돼요" with title "📤 공유했어요"
    end if
  on error errText number errNum
    if errNum is not -128 then
      log errText
      display notification errText with title "⚠️ 업무 공유 실패"
    end if
  end try
end run
APPLESCRIPT
