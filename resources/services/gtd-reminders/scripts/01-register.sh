#!/bin/zsh
# @svc-name: 업무 등록
# @svc-hotkey: Alt+1
# @svc-description: 할 일이 떠올랐을 때 누르세요. 프로젝트가 여러 개면 어디에 넣을지 고르고, 없으면 수집함으로 바로 들어가요.

osascript <<'APPLESCRIPT'
on ownedListNames()
  set out to {}
  tell application "Reminders"
    repeat with l in lists
      if (name of l) starts with "GTD " then set end of out to (name of l)
    end repeat
  end tell
  return out
end ownedListNames

try
  set INBOX to "GTD 수집함"

  activate
  set dlg to display dialog "무엇을 할까요?" default answer "" with title "업무 등록" buttons {"취소", "등록"} default button "등록" cancel button "취소"
  set theTitle to text returned of dlg
  if theTitle is "" then return

  tell application "Reminders"
    if not (exists list INBOX) then make new list with properties {name:INBOX}
  end tell

  set targetList to INBOX
  set projectNames to my ownedListNames()
  if (count of projectNames) > 1 then
    -- Re-activate right before this dialog: the Reminders lookups above are
    -- separate Apple Events, and without activating again immediately
    -- before `choose from list`, its first click only steals focus instead
    -- of registering (see mac-shortcut-manager commit a43dac1).
    activate
    set picked to (choose from list projectNames with title "업무 등록" with prompt "어디에 등록할까요?" OK button name "선택" cancel button name "건너뛰기(수집함)" default items {INBOX} without multiple selections allowed)
    if picked is not false then set targetList to item 1 of picked
  end if

  tell application "Reminders"
    tell list targetList
      make new reminder with properties {name:theTitle}
    end tell
  end tell

  display notification theTitle with title ("📥 등록했어요 · " & targetList)
on error errText number errNum
  if errNum is not -128 then
    log errText
    display notification errText with title "⚠️ 업무 등록 실패"
  end if
end try
APPLESCRIPT
