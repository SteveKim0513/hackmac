#!/bin/zsh
# @svc-name: 프로젝트 등록
# @svc-hotkey: Alt+\
# @svc-description: 새 프로젝트가 생기면 누르세요. 이름을 입력하고 업무·개인 중 골라두면 미리알림 리스트가 만들어지고, 다음 '업무 등록'부터 바로 선택할 수 있어요. 업무는 '업무 공유하기' 때 전부 읽히고, 개인은 공유 대상에서 빠져요.

# 1. 프로젝트 이름 입력.
rawName=$("$HACKMAC_POPUP" prompt --title "프로젝트 등록" --prompt "프로젝트 이름을 입력하세요" --ok "만들기" --cancel "취소")
if [[ $? -ne 0 || -z "$rawName" ]]; then
  exit 0
fi

# 2. 업무/개인 카테고리 선택 — 리스트 이름에 "GTD 업무 "/"GTD 개인 " 접두어로
# 인코딩한다(별도 DB 없이 이름 자체가 진실 소스라는 "서비스 설계 원칙" 유지).
# 업무는 공유하기(05-share.sh)가 전부 읽어 처리하고, 개인은 공유 대상에서
# 빠진다. "GTD 개인 "으로 시작하지 않는 모든 리스트(수집함, 이 선택 이전에
# 만든 "GTD 🗂 " 프로젝트 포함)는 업무로 취급된다.
category=$("$HACKMAC_POPUP" select --title "프로젝트 등록" --prompt "이 프로젝트는 업무예요, 개인이예요?" --ok "선택" --cancel "취소" --default "업무" -- "업무" "개인")
if [[ $? -ne 0 || -z "$category" ]]; then
  exit 0
fi

# 3. 리스트 생성 — 값은 인자로 넘긴다. "GTD " 접두사가 붙어야 다른
# 스크립트들이 이 리스트를 자기 소유로 인식한다.
osascript - "$rawName" "$category" <<'APPLESCRIPT'
on run argv
  set rawName to item 1 of argv
  set category to item 2 of argv
  set theName to "GTD " & category & " 🗂 " & rawName
  try
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
end run
APPLESCRIPT
