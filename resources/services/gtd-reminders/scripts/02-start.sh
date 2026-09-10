#!/bin/zsh
# @svc-name: 업무 시작
# @svc-hotkey: Alt+2
# @svc-description: 지금 손댈 일이 정해지면 누르세요. 등록해둔 일 중 하나를 고르면 그 순간부터 소요시간이 재기 시작해요. 여러 번 눌러 여러 건을 동시에 진행중으로 둘 수 있어요.

osascript <<'APPLESCRIPT'
try
  -- 시작 표시는 마감일 필드에 "시작 시각"을 심어두는 식으로 구현했다 — 완료
  -- 처리 시점에 (완료 시각 - 이 값)으로 소요시간을 계산한다. 그래서 마감일이
  -- 없으면 "대기", 있으면 "진행중"으로 판정한다.
  set waitingNames to {}
  set ongoingCount to 0

  tell application "Reminders"
    repeat with l in lists
      if (name of l) starts with "GTD " then
        set nms to name of every reminder of l
        set cds to completed of every reminder of l
        set dds to due date of every reminder of l
        repeat with i from 1 to (count of nms)
          if (item i of cds) is false then
            if (item i of dds) is missing value then
              set end of waitingNames to (item i of nms)
            else
              set ongoingCount to ongoingCount + 1
            end if
          end if
        end repeat
      end if
    end repeat
  end tell

  if (count of waitingNames) is 0 then
    display notification "아직 등록한 일이 없어요 — 업무 등록으로 먼저 담아보세요" with title "📋 시작할 일 없음"
    return
  end if

  if ongoingCount ≥ 3 then
    activate
    display dialog ("지금 " & ongoingCount & "개 진행중이에요. 하나 더 시작할까요?") with title "업무 시작" buttons {"취소", "시작"} default button "시작" cancel button "취소"
  end if

  -- Reminders 조회(위 tell 블록)가 다시 Apple Event를 보냈으므로, 이 다이얼로그
  -- 직전에 activate를 다시 호출하지 않으면 첫 클릭이 선택이 아니라 포커스
  -- 되찾기로만 소비된다 (mac-shortcut-manager commit a43dac1).
  activate
  set picked to (choose from list waitingNames with title "업무 시작" with prompt "무엇을 시작할까요?" OK button name "시작" cancel button name "취소" without multiple selections allowed)
  if picked is false then return
  set chosenName to item 1 of picked

  tell application "Reminders"
    repeat with l in lists
      if (name of l) starts with "GTD " then
        set matches to (every reminder of l whose name is chosenName and completed is false)
        if (count of matches) > 0 then
          set due date of (item 1 of matches) to (current date)
          exit repeat
        end if
      end if
    end repeat
  end tell

  display notification chosenName with title "▶️ 시작했어요"
on error errText number errNum
  if errNum is not -128 then
    log errText
    display notification errText with title "⚠️ 업무 시작 실패"
  end if
end try
APPLESCRIPT
