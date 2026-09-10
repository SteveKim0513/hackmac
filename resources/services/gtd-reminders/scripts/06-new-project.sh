#!/bin/zsh
# @svc-name: 프로젝트 등록
# @svc-hotkey: Alt+6
# @svc-description: 새 프로젝트가 생기면 누르세요. 이름만 입력하면 미리알림 리스트가 만들어지고, 다음 '업무 등록'부터 바로 선택할 수 있어요.

osascript <<'APPLESCRIPT'
try
  activate
  set dlg to display dialog "프로젝트 이름을 입력하세요" default answer "" with title "프로젝트 등록" buttons {"취소", "만들기"} default button "만들기" cancel button "취소"
  set rawName to text returned of dlg
  if rawName is "" then return

  -- "GTD " 접두사가 붙어야 다른 스크립트들이 이 리스트를 자기 소유로 인식한다.
  set theName to "GTD 🗂 " & rawName

  tell application "Reminders"
    if exists list theName then
      display notification theName with title "이미 있는 프로젝트예요"
      return
    end if
    make new list with properties {name:theName}
  end tell

  display notification theName with title "🚀 프로젝트를 만들었어요"
on error errText number errNum
  if errNum is not -128 then
    log errText
    display notification errText with title "⚠️ 프로젝트 등록 실패"
  end if
end try
APPLESCRIPT
