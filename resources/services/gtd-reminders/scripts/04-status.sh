#!/bin/zsh
# @svc-name: 업무 현황보기
# @svc-hotkey: Alt+9
# @svc-description: 지금 뭐가 얼마나 밀렸는지 궁금할 때 누르세요. 업무·개인을 나눠서 대기·진행중·오늘 완료 개수는 물론, 진행중인 일마다 이름과 경과 시간까지 보여줘요.

# 순수 조회 + 요약 문자열 조립까지는 osascript가 담당하고, 화면에 보여주는
# 건 그 결과를 받아 "$HACKMAC_POPUP"이 담당한다.
summary=$(osascript <<'APPLESCRIPT'
try
  -- 업무/개인 카테고리별로 따로 집계한다 — "GTD 개인 "으로 시작하는 리스트만
  -- 개인, 나머지(수집함 포함)는 전부 업무.
  set waitingCount to {0, 0}
  set ongoingCount to {0, 0}
  set doneTodayCount to {0, 0}
  set detailLines to {{}, {}}
  set catLabels to {"업무", "개인"}
  set todayStart to (current date) - (time of (current date))

  tell application "Reminders"
    repeat with l in lists
      if (name of l) starts with "GTD " then
        if (name of l) starts with "GTD 개인 " then
          set catIdx to 2
        else
          set catIdx to 1
        end if
        set nms to name of every reminder of l
        set cds to completed of every reminder of l
        set dds to due date of every reminder of l
        set eds to completion date of every reminder of l
        set bds to body of every reminder of l
        repeat with i from 1 to (count of nms)
          if (item i of cds) is false then
            if (item i of dds) is missing value then
              set item catIdx of waitingCount to ((item catIdx of waitingCount) + 1)
            else
              set item catIdx of ongoingCount to ((item catIdx of ongoingCount) + 1)
              set diffSec to (current date) - (item i of dds)
              set h to diffSec div 3600
              set m to (diffSec mod 3600) div 60
              if h > 0 then
                set dur to (h as string) & "시간 " & (m as string) & "분째"
              else
                set dur to (m as string) & "분째"
              end if

              -- notes(body)에 "target=<분>"이 있으면 목표 시간도 같이 보여준다
              -- (01-register.sh가 등록 시 심어둔다).
              set theBody to item i of bds
              if theBody is missing value then set theBody to ""
              set targetMinutes to missing value
              repeat with ln in paragraphs of theBody
                if ln starts with "target=" then
                  try
                    set targetMinutes to (text 8 thru -1 of ln) as integer
                  end try
                end if
              end repeat
              if targetMinutes is not missing value then
                set dur to dur & " · 목표 " & targetMinutes & "분"
              end if

              set item catIdx of detailLines to ((item catIdx of detailLines) & {"· " & (item i of nms) & " (" & dur & ")"})
            end if
          else
            set ed to item i of eds
            if ed is not missing value and ed ≥ todayStart then
              set item catIdx of doneTodayCount to ((item catIdx of doneTodayCount) + 1)
            end if
          end if
        end repeat
      end if
    end repeat
  end tell

  log "Reminders 조회 완료: 업무 진행중 " & (item 1 of ongoingCount) & "개/완료 " & (item 1 of doneTodayCount) & "개/대기 " & (item 1 of waitingCount) & "개, 개인 진행중 " & (item 2 of ongoingCount) & "개/완료 " & (item 2 of doneTodayCount) & "개/대기 " & (item 2 of waitingCount) & "개"

  set summary to ""
  repeat with catIdx from 1 to 2
    set catLabel to item catIdx of catLabels
    set section to catLabel & " — 진행중 " & (item catIdx of ongoingCount) & "개 · 완료 " & (item catIdx of doneTodayCount) & "개 · 대기 " & (item catIdx of waitingCount) & "개"
    if (item catIdx of ongoingCount) > 0 then
      set AppleScript's text item delimiters to linefeed
      set detailText to (item catIdx of detailLines) as string
      set AppleScript's text item delimiters to ""
      set section to section & linefeed & detailText
    end if
    if summary is "" then
      set summary to section
    else
      set summary to summary & linefeed & linefeed & section
    end if
  end repeat

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
