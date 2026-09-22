#!/bin/zsh
# @svc-name: 업무 등록
# @svc-hotkey: Alt+1
# @svc-description: 할 일이 떠올랐을 때 누르세요. 프로젝트가 여러 개면 어디에 넣을지 고르고, 없으면 수집함으로 바로 들어가요.

INBOX="GTD 수집함"

# 1. 제목 입력 — 팝업은 HackMac 앱이 그린다("$HACKMAC_POPUP", CLAUDE.md "서비스
# 설계 원칙" 참고). 취소(Esc/취소 버튼)는 종료 코드 1로 돌아온다.
theTitle=$("$HACKMAC_POPUP" prompt --title "업무 등록" --prompt "무엇을 할까요?" --ok "등록" --cancel "취소")
if [[ $? -ne 0 || -z "$theTitle" ]]; then
  exit 0
fi
echo "제목 입력 완료: $theTitle"

# 2. 수집함이 없으면 만들고, GTD 프로젝트 리스트 이름을 조회 — 다이얼로그가
# 없는 순수 조회라 osascript를 그대로 쓴다.
projectNamesRaw=$(osascript <<APPLESCRIPT
tell application "Reminders"
  if not (exists list "$INBOX") then make new list with properties {name:"$INBOX"}
  set out to {}
  repeat with l in lists
    if (name of l) starts with "GTD " then set end of out to (name of l)
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
APPLESCRIPT
)
if [[ -n "$projectNamesRaw" ]]; then
  projectNames=("${(@f)projectNamesRaw}")
else
  projectNames=()
fi
echo "프로젝트 목록 조회 완료: ${#projectNames[@]}개"

# 3. 프로젝트가 여러 개일 때만 고르게 한다 — 취소(건너뛰기)하면 수집함 그대로.
# 업무/개인 구간 헤더로 나눠 보여준다 — "GTD 개인 "으로 시작하는 리스트만
# 개인, 나머지(수집함 포함)는 전부 업무.
targetList="$INBOX"
if (( ${#projectNames[@]} > 1 )); then
  workProjects=()
  personalProjects=()
  for n in "${projectNames[@]}"; do
    if [[ "$n" == "GTD 개인 "* ]]; then
      personalProjects+=("개인"$'\x1f'"$n")
    else
      workProjects+=("업무"$'\x1f'"$n")
    fi
  done
  projectItems=("${workProjects[@]}" "${personalProjects[@]}")
  picked=$("$HACKMAC_POPUP" select --title "업무 등록" --prompt "어디에 등록할까요?" --ok "선택" --cancel "건너뛰기(수집함)" --default "$INBOX" -- "${projectItems[@]}")
  if [[ $? -eq 0 && -n "$picked" ]]; then
    targetList="$picked"
  fi
fi

# 4. 목표 시간 선택 — 10분 단위 프리셋 중 고르거나 건너뛴다(취소 = 목표 없음).
# 자유 입력 대신 select로 고정한 이유: "10분 단위"라는 제약을 프롬프트 검증
# 없이 그 자체로 보장하기 위해서다.
targetOptions=(10분 20분 30분 40분 50분 60분 90분 120분 180분 240분)
targetLabel=$("$HACKMAC_POPUP" select --title "업무 등록" --prompt "목표 시간을 정할까요?" --ok "설정" --cancel "건너뛰기(목표 없음)" -- "${targetOptions[@]}")
targetMinutes=""
if [[ $? -eq 0 && -n "$targetLabel" ]]; then
  targetMinutes="${targetLabel%분}"
fi
echo "목표 시간: ${targetMinutes:-없음}"

# 5. 실제 등록 — 값은 인자로 넘긴다(`osascript - "$1" ... <<'EOF'`처럼 `-`를
# 붙여야 인자가 stdin 스크립트 대신 파일 경로로 오인되지 않는다). 목표 시간은
# notes(AppleScript에서는 body) 필드에 "target=<분>" 한 줄로 남겨둔다 — 완료
# 처리(03-complete.sh)가 이 값을 읽어 실제 소요시간과 비교한다.
osascript - "$theTitle" "$targetList" "$targetMinutes" <<'APPLESCRIPT'
on run argv
  set theTitle to item 1 of argv
  set targetList to item 2 of argv
  set targetMinutes to item 3 of argv
  try
    tell application "Reminders"
      tell list targetList
        if targetMinutes is "" then
          make new reminder with properties {name:theTitle}
        else
          make new reminder with properties {name:theTitle, body:"target=" & targetMinutes}
        end if
      end tell
    end tell
    if targetMinutes is "" then
      log "리마인더 생성 완료 (목표 없음)"
    else
      log "리마인더 생성 완료 (목표 " & targetMinutes & "분)"
    end if
    display notification theTitle with title ("📥 등록했어요 · " & targetList)
  on error errText number errNum
    if errNum is not -128 then
      log errText
      display notification errText with title "⚠️ 업무 등록 실패"
    end if
  end try
end run
APPLESCRIPT
