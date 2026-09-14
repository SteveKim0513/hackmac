#!/bin/zsh
# @svc-name: 업무 구조 정규화
# @svc-hotkey: Control+Alt+0
# @svc-description: 미리알림에 이미 다른 목록·할 일이 있을 수 있는 첫 사용 시점에 누르세요. 그대로 두고 GTD 구조만 더할지, 전부 지우고 GTD만 남길지 고를 수 있어요. (폴더로 묶어둔 목록도 안까지 다 지워지지만, 다 지운 뒤 빈 폴더 껍데기 자체는 애플이 API를 안 열어둬서 미리알림 앱에서 직접 지워야 해요.)

osascript -l JavaScript <<'JXA'
ObjC.import('EventKit');
ObjC.import('Foundation');

var app = Application.currentApplication();
app.includeStandardAdditions = true;

var INBOX = "GTD 수집함";

// AppleScript의 "tell application Reminders"는 폴더(사이드바에서 목록 여러 개를
// 묶어두는 기능) 안에 든 목록을 계정에서 열거해도 못 찾고, 이름으로 직접
// 지정해도 "가져올 수 없습니다" 에러가 난다 — 실사용자 리포트로 확인됨
// ("Information" 폴더 안 5개 목록이 매번 조회에서 통째로 빠짐). EventKit은
// 계정·폴더 구분 없이 미리알림 목록을 평평하게 돌려주므로 읽기/만들기/지우기를
// 전부 EventKit으로 한다.
function requestReminderAccess() {
  var store = $.EKEventStore.alloc.init;
  var done = false;
  var granted = false;
  store.requestAccessToEntityTypeCompletion($.EKEntityTypeReminder, function (g, err) {
    granted = g;
    done = true;
  });
  var start = $.NSDate.date;
  while (!done && (-start.timeIntervalSinceNow) < 20) {
    $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.1));
  }
  return granted ? store : null;
}

function allReminderCalendars(store) {
  var cals = store.calendarsForEntityType($.EKEntityTypeReminder);
  var list = [];
  for (var i = 0; i < cals.count; i++) {
    list.push(cals.objectAtIndex(i));
  }
  return list;
}

function findByTitle(cals, title) {
  for (var i = 0; i < cals.length; i++) {
    if (ObjC.unwrap(cals[i].title) === title) return cals[i];
  }
  return null;
}

function createInbox(store, source) {
  var cal = $.EKCalendar.calendarForEntityTypeEventStore($.EKEntityTypeReminder, store);
  cal.title = INBOX;
  cal.source = source;
  var err = $();
  store.saveCalendarCommitError(cal, true, err);
}

function main() {
  app.activate();
  var dlg = app.displayDialog("미리알림에 이미 있는 목록·할 일은 어떻게 할까요?", {
    withTitle: "업무 구조 정규화",
    buttons: ["취소", "그대로 두고 GTD만 준비", "전부 지우고 GTD만 남기기"],
    defaultButton: "그대로 두고 GTD만 준비",
    cancelButton: "취소"
  });
  var choice = dlg.buttonReturned;
  console.log("선택: " + choice);

  var store = requestReminderAccess();
  if (!store) {
    console.log("미리알림 접근 권한 거부됨");
    app.displayNotification("미리알림 접근 권한이 필요해요 — 시스템 설정 > 개인정보 보호 및 보안에서 허용해주세요", { withTitle: "⚠️ 정규화 실패" });
    return;
  }

  if (choice === "그대로 두고 GTD만 준비") {
    var cals = allReminderCalendars(store);
    if (findByTitle(cals, INBOX)) {
      app.displayNotification("이미 잘 되어 있어요 — 바꿀 게 없어요", { withTitle: "🧭 정규화" });
    } else {
      createInbox(store, store.defaultCalendarForNewReminders.source);
      app.displayNotification("GTD 수집함을 만들었어요", { withTitle: "🧭 정규화" });
    }
    return;
  }

  // "전부 지우고 GTD만 남기기": 미리알림 앱의 모든 목록·할 일을 지우는,
  // 되돌릴 수 없고 iCloud로 다른 기기에도 퍼지는 조작이라 버튼 클릭 한 번보다
  // 무거운 확인 절차를 둔다 — 정확한 문구를 직접 입력해야만 진행된다.
  app.activate();
  var confirmDlg = app.displayDialog(
    "이 작업은 되돌릴 수 없어요. 미리알림 앱의 모든 목록과 할 일이 이 기기와 iCloud로 동기화된 다른 기기에서도 전부 삭제돼요(폴더 안에 있는 목록 포함). 다만 빈 폴더 껍데기 자체는 남을 수 있어요 — 그건 미리알림 앱에서 직접 지워주세요.\n\n계속하려면 아래 칸에 \"삭제\"라고 입력하세요.",
    {
      defaultAnswer: "",
      withTitle: "정말 전부 지울까요",
      buttons: ["취소", "삭제 실행"],
      defaultButton: "취소",
      cancelButton: "취소",
      withIcon: "caution"
    }
  );
  if (confirmDlg.textReturned !== "삭제") {
    app.displayNotification("확인 문구가 달라서 취소했어요", { withTitle: "🧭 정규화" });
    return;
  }

  // iCloud 계정은 미리알림 목록이 항상 1개 이상 있어야 해서, 계정에 남은
  // 마지막 목록은 지우기 자체가 거부된다. 다 지운 다음에 GTD 수집함을
  // 만들면 삭제 루프 도중 우연히 마지막 순서로 걸린 목록이 그 시점의
  // "유일한 목록"이 되어 삭제가 실패한다 — 그래서 GTD 수집함을 먼저 만들어
  // 계정에 항상 목록이 있는 상태를 유지한 뒤에 기존 목록들을 지운다.
  var fallbackSource = store.defaultCalendarForNewReminders.source;
  var beforeCals = allReminderCalendars(store);

  createInbox(store, fallbackSource);

  console.log("삭제 대상 목록 " + beforeCals.length + "개: " + beforeCals.map(function (c) { return ObjC.unwrap(c.title); }).join(", "));

  var deletedCount = 0;
  var keptCount = 0;
  for (var i = 0; i < beforeCals.length; i++) {
    var title = ObjC.unwrap(beforeCals[i].title);
    // NSError 아웃 파라미터(마지막 인자)는 JXA의 ObjC 브릿지로 안정적으로
    // 읽어낼 방법을 못 찾았다 — $()로 넘기면 실패해도 값이 비어 있고,
    // Ref()로 넘기면 이 호출 자체가 크래시했다(둘 다 실사용 EventKit
    // 호출로 직접 확인함). 그래서 실패 사유 문자열 대신 어떤 목록이
    // 지워졌는지/안 지워졌는지만 목록별로 남긴다.
    var ok = store.removeCalendarCommitError(beforeCals[i], true, $());
    if (ok) {
      deletedCount++;
      console.log("지움: " + title);
    } else {
      keptCount++;
      console.log("못 지움: " + title);
    }
  }

  if (keptCount === 0) {
    app.displayNotification("목록 " + deletedCount + "개를 지우고 GTD 구조만 새로 만들었어요", { withTitle: "🧭 정규화 완료" });
  } else {
    app.displayNotification("목록 " + deletedCount + "개를 지웠어요 (" + keptCount + "개는 지울 수 없었어요) · GTD 구조를 새로 만들었어요", { withTitle: "🧭 정규화 완료" });
  }
}

try {
  main();
} catch (e) {
  if (e.errorNumber !== -128) {
    // 알림은 화면에서 금방 사라지므로, 나중에 로그만 보고 원인을 알 수
    // 있도록 실제 에러 내용을 stderr에도 남긴다(오류 로그 파일에 그대로
    // 잡힘 — electron/runner.ts가 자식 프로세스의 stderr를 줄 단위로 기록).
    console.log("정규화 실패: " + String(e) + (e.stack ? "\n" + e.stack : ""));
    app.displayNotification(String(e), { withTitle: "⚠️ 정규화 실패" });
  }
}
JXA
