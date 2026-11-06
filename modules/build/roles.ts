/**
 * 전문 담당(역할) 정의와 일을 시키는 글(프롬프트). 제작은 한 에이전트가 처음부터 끝까지 하지 않는다 —
 * 요구 정리 담당(채팅)이 사용자와 요구를 확정하면, HackMac 코드가 다음 담당들을 차례로 부른다(modules/build/pipeline.ts).
 *
 *   요구 정리  (채팅, resources/agent/builder.md)   질문으로 사용자의 암묵 기준을 캐내 요구사항·합격 기준으로 고정 → handoff
 *   채점       examiner   일하기 전에 채점표부터(요구사항마다 관찰 가능한 합격 기준). 다른 회사 엔진. 이후 시험·감사가 이 표로 채점한다
 *   설계       designer   요구사항 → 서비스 기준을 입힌 설계(spec/design.md)
 *   개발       developer  설계 → app/ (선언·스크립트). 시험·카피는 안 만진다
 *   카피       copywriter manifest의 스토어 카피만 쓴다(docs/service-copy-guide.md)
 *   시험       tester     checks/*.sh. 앱 코드는 못 고친다 — 만든 쪽이 자기 시험을 쓰지 않게, 다른 회사 엔진이 한다
 *   감사       auditor    요구사항 전체 + 서비스 기준을 코드에 대어 본다(다른 회사 엔진). 코드는 안 고친다
 *
 * 담당끼리는 말이 아니라 파일로 넘긴다: 요구사항(진행 기록) → spec/design.md → app/ → checks/. 각 담당은 자기 지시문(resources/agent/roles/<id>.md)만 본다.
 * 프롬프트의 첫 줄에 "너는 … 담당이다"를 두는 것은 가짜 엔진(시험)이 역할을 알아보는 표시이기도 하다.
 */
import type { AuditItem } from './audit.ts';

export type RoleId = 'examiner' | 'designer' | 'developer' | 'copywriter' | 'tester' | 'auditor';

export interface RoleSpec {
  id: RoleId;
  /** 화면에 보이는 이름 */
  label: string;
  /** 지금 하는 일(쉬운 말) */
  doing: string;
  /** builder: 이 스레드의 엔진 / other: 만든 쪽과 다른 회사 엔진(가능하면) */
  side: 'builder' | 'other';
  /** files: 작업 폴더 안에서 읽고 쓴다 / none: 도구 없이 글만 */
  tools: 'files' | 'none';
  /** resources/agent/roles/ 아래 지시문 파일 */
  file: string;
}

export const ROLES: Record<RoleId, RoleSpec> = {
  examiner: { id: 'examiner', label: '채점 담당', doing: '채점 담당이 합격 기준을 먼저 쓰는 중', side: 'other', tools: 'none', file: 'examiner.md' },
  designer: { id: 'designer', label: '설계 담당', doing: '설계 담당이 서비스로 설계하는 중', side: 'builder', tools: 'files', file: 'designer.md' },
  developer: { id: 'developer', label: '개발 담당', doing: '개발 담당이 앱을 만드는 중', side: 'builder', tools: 'files', file: 'developer.md' },
  copywriter: { id: 'copywriter', label: '카피 담당', doing: '카피 담당이 앱 소개를 쓰는 중', side: 'builder', tools: 'files', file: 'copywriter.md' },
  tester: { id: 'tester', label: '시험 담당', doing: '시험 담당이 시험을 만드는 중', side: 'other', tools: 'files', file: 'tester.md' },
  auditor: { id: 'auditor', label: '감사 담당', doing: '감사 담당이 목표를 하나씩 확인하는 중', side: 'other', tools: 'none', file: 'auditor.md' },
};

export interface Req { id: string; text: string; manual: string | null; accept?: string[] }

const reqLines = (rs: Req[]): string[] =>
  rs.flatMap((r) => [`${r.id}. ${r.text}${r.manual ? ` (자동 시험 불가: ${r.manual})` : ''}`, ...(r.accept ?? []).map((a) => `   - 사용자 합격 기준: ${a}`)]);

/** 채점표를 각 담당에게 보여 줄 줄 */
export const rubricLines = (items: { id: string; req: string; criterion: string; how: 'auto' | 'manual' }[]): string[] =>
  items.map((x) => `${x.id} (${x.req}, ${x.how === 'auto' ? '시험으로 확인' : '사용자가 확인'}) ${x.criterion}`);

/** 지난 제작에서 쌓인 것(modules/knowledge). 비어 있으면 아무것도 안 붙인다 */
const lessonBlock = (lessons: string[]): string[] => (lessons.length ? ['', '## 지난 제작에서 배운 것(같은 실수를 하지 않는다)', ...lessons.map((l) => `- ${l}`)] : []);

export const examinerPrompt = (i: { requirements: Req[]; baseline: { id: string; text: string }[] }): string =>
  [
    '너는 HackMac의 채점 담당이다. 앱은 아직 없다. 만들기 전에 "무엇이 되면 합격인지" 채점표부터 쓴다. 이 표로 나중에 시험 담당이 시험을 만들고 감사 담당이 채점한다.',
    '사용자는 개발을 모른다. 그래서 기준은 사용자가 결과만 보고도 판정할 수 있는 말로, 그리고 시험으로 잴 수 있게 구체적으로 쓴다(숫자·출력·보이는 말).',
    '',
    '## 규칙',
    '- 요구사항마다 기준 2~4개. 정상 경우 하나, 빈 결과·실패 같은 경계 경우 하나 이상.',
    '- 사용자 합격 기준이 적혀 있으면 그대로 기준에 포함한다(말을 바꾸지 않는다).',
    '- "잘 된다", "빠르다" 같은 말 금지. "3초 안에 알림이 뜬다", "일정이 없으면 \"오늘은 일정이 없어요\"가 뜬다"처럼 쓴다.',
    '- how: 빈 가짜 홈에서 스크립트로 확인할 수 있으면 auto, 실제 알림이 뜨는지·실제 시각에 도는지처럼 사람이 봐야 하면 manual.',
    '- id는 R번호.순번(R1.1, R1.2 …).',
    '',
    '## 요구사항',
    ...reqLines(i.requirements),
    '',
    '## 서비스 기준(참고: 요구사항 기준에 자연스럽게 녹인다)',
    ...i.baseline.map((b) => `${b.id}. ${b.text}`),
    '',
    '## 출력',
    '설명 없이 JSON 한 덩어리만. 마크다운 코드 블록도 쓰지 않는다. 모양:',
    '{"items":[{"id":"R1.1","req":"R1","criterion":"…","how":"auto"}]}',
  ].join('\n');

export const designerPrompt = (i: { requirements: Req[]; conditions: string[]; existing: boolean; rubric: string[]; lessons: string[] }): string =>
  [
    '너는 HackMac의 서비스 설계 담당이다. 코드를 짜지 않는다. 아래 요구사항을 "서비스" 수준의 설계로 만들어 ./spec/design.md 한 파일에 쓴다.',
    ...(i.existing ? ['이미 설치돼 있는 앱을 고치는 일이다. ./app/ 의 현재 선언·스크립트를 먼저 읽고, 바뀌는 곳과 그대로 둘 곳을 구분해 설계한다.'] : []),
    '',
    '## 요구사항',
    ...reqLines(i.requirements),
    ...(i.conditions.length ? ['', '## 사용자가 받아들인 조건', ...i.conditions.map((c) => `- ${c}`)] : []),
    '',
    '## 채점표(이 기준으로 채점된다)',
    ...i.rubric,
    ...lessonBlock(i.lessons),
    '',
    '## 후보 실험(선택)',
    '구현 방법이 둘 이상이고 어느 쪽이 나은지 경험으로 확신할 수 없으면(속도·정확도), 추측하지 말고 ./spec/experiments.json 에 후보를 적는다. HackMac이 격리된 곳(빈 가짜 홈, 기본 PATH, 실제 캘린더·미리알림 등은 없음)에서 후보마다 실제로 돌려 시간과 성공을 재고 이긴 것을 개발 담당에게 준다.',
    '모양: {"experiments":[{"question":"무엇을 고르나","criterion":"합격 기준(예: 종료 0이고 2초 안)","maxMs":2000,"candidates":[{"name":"A","script":"#!/bin/zsh\\n…"},{"name":"B","script":"…"}]}]}',
    '후보 스크립트는 성공이면 종료 0. 실제 앱(osascript로 Calendar 등)을 건드리지 않는 것만 실험한다. 필요 없으면 파일을 만들지 않는다.',
    '',
    '설계 문서에는 반드시: (1) 요구사항마다 R번호 제목 아래 "어떻게 구현하는지"와 "어떤 설정·스크립트가 맡는지", (2) 설정 목록(키·이름·종류·기본값·필수 여부, 시각이면 time·간격이면 number, 스케줄이 그 설정을 어떻게 쓰는지), (3) 서비스 기준 S2~S8을 이 앱에 어떻게 적용하는지(첫 사용 안내, 결과가 안 보이는 경로가 없게 하는 법, 실패할 수 있는 곳과 그때 보일 말), (4) 필요한 권한과 접속 주소, (5) 시험 계획(요구사항별 + 실패 경로)을 넣는다.',
    '끝나면 "설계를 마쳤다"고 한 줄로만 답한다.',
  ].join('\n');

export const developerPrompt = (i: { requirements: Req[]; round: number; problems: string[]; existing: boolean; rubric: string[]; lessons: string[]; experiments: string[] }): string =>
  i.round === 0
    ? [
        '너는 HackMac의 개발 담당이다. ./spec/design.md 의 설계대로 ./app/ 에 앱 패키지(manifest.json, scripts/)를 만든다.',
        ...(i.existing ? ['이미 설치돼 있는 앱이다. ./app/ 에 현재 버전이 있다. 바뀌는 부분만 고치고 manifest의 version을 1 올린다. 요구사항 전체가 계속 만족돼야 한다.'] : []),
        'checks/ 는 만들지 않는다(시험 담당이 쓴다). 스토어 카피(tagline·usage 등)는 간단히만 채운다(카피 담당이 다시 쓴다).',
        '',
        '## 요구사항',
        ...reqLines(i.requirements),
        '',
        '## 채점표(이 기준으로 채점된다)',
        ...i.rubric,
        ...(i.experiments.length ? ['', '## 후보 실험 결과(이긴 방법을 쓴다)', ...i.experiments] : []),
        ...lessonBlock(i.lessons),
        '',
        '끝나면 무엇을 만들었는지 두세 문장으로 답한다.',
      ].join('\n')
    : [
        `너는 HackMac의 개발 담당이다. 검증과 감사가 아래 문제를 찾았다(${i.round}번째 보완). ./app/ 을 고쳐서 모두 해결한다. checks/ 는 만지지 않는다.`,
        '',
        '## 고칠 것',
        ...i.problems.map((p) => `- ${p}`),
        '',
        '## 요구사항(전부 계속 만족돼야 한다)',
        ...reqLines(i.requirements),
        '',
        '## 채점표',
        ...i.rubric,
        ...lessonBlock(i.lessons),
        '',
        '끝나면 무엇을 고쳤는지 두세 문장으로 답한다.',
      ].join('\n');

export const copywriterPrompt = (): string =>
  [
    '너는 HackMac의 카피 담당이다. ./app/manifest.json 의 스토어 카피 칸(tagline, usage, whatItIs, differentiators, strengths)만 다시 쓴다. 다른 칸(트리거·설정·권한·id·version 등)은 한 글자도 바꾸지 않는다.',
    './spec/design.md 와 ./app/scripts/ 를 읽고 앱이 실제로 하는 일만 쓴다. 설정이 있으면 usage에 "앱 상세의 설정에서 바꿀 수 있어요"를 넣고, 처음 쓸 때 뜨는 권한 창이 있으면 그것도 안내한다.',
    '끝나면 "카피를 마쳤다"고 한 줄로 답한다.',
  ].join('\n');

export const testerPrompt = (i: { requirements: Req[]; round: number; problems: string[]; rubric: string[]; lessons: string[] }): string =>
  [
    '너는 HackMac의 시험 담당이다. 앱 코드를 짠 사람이 아니다. ./app/ 을 읽고 ./app/checks/ 에 시험을 쓴다. manifest.json 과 scripts/ 는 절대 고치지 않는다(고치면 되돌려지고 시험이 무효가 된다).',
    '- 요구사항마다 checks/R<번호>-<이름>.sh. 자동 시험이 불가능한 요구사항(manual)도 판단·가공 부분은 시험한다.',
    '- 외부 접속이나 다른 앱 자동화가 있는 앱이면 실패 경로를 시험하는 checks/E1-<이름>.sh 를 최소 하나 쓴다(예: 접속 실패·빈 결과·필수 설정이 비었을 때 앱이 조용히 끝나지 않고 알리는지).',
    '- 채점표의 auto 기준은 하나도 빠짐없이 시험으로 만든다. 시험 파일 맨 위 주석에 그 파일이 재는 기준 id를 적는다(예: # 기준: R1.1 R1.2).',
    '- 시험은 성공이면 종료 0, 실패면 0이 아닌 값.',
    ...(i.round > 0 ? ['', `${i.round}번째 보완이다. 개발 담당이 아래를 고쳤다. 시험이 이 변화를 보도록 갱신한다:`, ...i.problems.map((p) => `- ${p}`)] : []),
    '',
    '## 요구사항',
    ...reqLines(i.requirements),
    '',
    '## 채점표',
    ...i.rubric,
    ...lessonBlock(i.lessons),
    '',
    '끝나면 어떤 시험을 만들었는지 두세 문장으로 답한다.',
  ].join('\n');

export const auditorPrompt = (i: {
  requirements: Req[];
  rubric: string[];
  baseline: { id: string; text: string }[];
  files: { path: string; text: string }[];
  truncated: boolean;
}): string =>
  [
    '너는 HackMac의 목표 달성 감사 담당이다. 앱을 만들거나 고치지 않는다. 아래 앱 파일을 읽고, 요구사항과 서비스 기준이 "실제로 코드에서 이뤄지는지"를 항목마다 판정한다.',
    '',
    '## 판정 원칙',
    '- 말이 아니라 코드를 본다. 충족(met:true)이려면 evidence에 "어느 파일이 무엇을 해서 이 항목을 이루는지"를 적는다. 근거를 못 찾으면 met:false.',
    '- 요구사항에 "조정할 수 있다·바꿀 수 있다·정할 수 있다"가 있으면: manifest.json settings에 선언돼 있고, 스크립트(또는 스케줄 설정 참조)가 그 값을 실제로 읽을 때만 충족이다. 코드에 값이 박혀 있으면 미충족.',
    '- 일부만 되면 미충족이고, gap에 무엇이 빠졌는지 개발 담당이 바로 고칠 수 있게 구체적으로 적는다.',
    '- 너그럽게 보지 않는다. 확신이 없으면 미충족이다.',
    '',
    '## 요구사항(전부 판정)',
    ...reqLines(i.requirements),
    '',
    '## 채점표(요구사항은 이 기준을 모두 만족해야 충족이다. manual 기준은 코드에 그 동작이 있는지만 본다)',
    ...i.rubric,
    '',
    '## 서비스 기준(전부 판정)',
    ...i.baseline.map((b) => `${b.id}. ${b.text}`),
    '',
    `## 앱 파일${i.truncated ? '(길어서 일부만 담았다)' : ''}`,
    ...i.files.flatMap((f) => [`### ${f.path}`, '```', f.text, '```']),
    '',
    '## 출력',
    '설명 없이 JSON 한 덩어리만 출력한다. 마크다운 코드 블록도 쓰지 않는다. 모양:',
    '{"goals":[{"id":"R1","met":true,"evidence":"…","gap":""}],"baseline":[{"id":"S2","met":true,"evidence":"…","gap":""}]}',
  ].join('\n');

/** 개발 담당에게 돌려줄 문제 목록: 감사에서 미충족인 것 */
export const auditProblems = (items: AuditItem[]): string[] =>
  items.filter((x) => !x.met).map((x) => `[감사 ${x.id}] ${x.label} — ${x.gap || '근거를 코드에서 찾지 못함'}`);
