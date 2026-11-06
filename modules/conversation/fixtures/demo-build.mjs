// 가짜 엔진들이 쓰는 시험용 행동: 진짜 제작 에이전트가 하는 것과 같은 순서로 $HACKMAC_BUILD를 부르고 ./app을 만든다.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 가능성 평가 담당으로 불렸으면 판정 JSON을 돌려준다(modules/build/evaluate.ts의 출력 모양) */
export const evaluatorReply = (text) =>
  text.includes('가능성 평가 담당') ? '{"kind":"possible","summary":"기본 도구로 바로 만들 수 있어요","conditions":[],"reasons":["date와 display notification만 쓴다"]}' : null;

const build = (...args) => {
  const r = spawnSync(process.env.HACKMAC_BUILD, args, { encoding: 'utf8', env: process.env });
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
};

/** "build-demo": 오늘 날짜 앱을 만들어 submit까지. 마지막 submit 출력을 답으로 돌려준다 */
export const demoBuild = (cwd) => {
  if (!process.env.HACKMAC_BUILD) return 'HACKMAC_BUILD가 없음';
  build('step', '1', '정리하는 중');
  build('req', 'R1', '단축키를 누르면 오늘 날짜를 알림으로 보여 준다');
  build('step', '2', '가능한지 확인하는 중');
  const ev = build('evaluate');
  build('step', '3', '앱을 만드는 중');
  const app = join(cwd, 'app');
  mkdirSync(join(app, 'scripts'), { recursive: true });
  mkdirSync(join(app, 'checks'), { recursive: true });
  writeFileSync(join(app, 'manifest.json'), JSON.stringify({
    schema: 1, id: 'my.today', version: '1', author: { name: 'me', signature: null }, hackmac: { min: '2.0.0' },
    name: '오늘 날짜', icon: '📅', tagline: '{hotkey:show} 누르면 오늘 날짜가 떠요', usage: ['{hotkey:show}를 누른다'],
    triggers: [{ kind: 'hotkey', script: 'scripts/show.sh', key: 'show', name: '날짜 보기', description: '알림으로 오늘 날짜를 보여 줘요' }],
    capabilities: {}, permissions: { network: [], automation: [], accessibility: false, fullDiskAccess: false }, settings: [], secrets: [], references: [],
  }));
  writeFileSync(join(app, 'scripts', 'show.sh'), '#!/bin/zsh\nd=$(date +%F)\necho "판단: 날짜=$d"\n[[ "$HACKMAC_CHECK" == 1 ]] && { print -r -- "$d" > "$HACKMAC_DATA_DIR/shown.txt"; exit 0; }\nosascript -e "display notification \\"$d\\" with title \\"오늘\\""\n');
  writeFileSync(join(app, 'checks', 'R1-shows-date.sh'), '#!/bin/zsh\nzsh "$HACKMAC_APP_DIR/scripts/show.sh" && [[ "$(cat "$HACKMAC_DATA_DIR/shown.txt")" == "$(date +%F)" ]]\n');
  build('step', '4', '스스로 시험하는 중');
  const verify = build('verify');
  const submit = build('submit');
  return [`평가: ${ev.split('\n')[0]}`, `검증: ${verify.split('\n')[0]}`, submit.split('\n')[0]].join('\n');
};

/** 유지보수 팀으로 불렸으면 고치는 행동을 한다(modules/maintain/team.ts의 프롬프트). 아니면 null */
export const fixReply = (text, cwd = process.cwd()) => {
  if (!text.includes('유지보수 팀이다')) return null;
  if (!process.env.HACKMAC_BUILD) return 'HACKMAC_BUILD가 없음';
  const incident = readFileSync(join(cwd, 'context', 'incident.md'), 'utf8');
  if (incident.includes('UNFIXABLE')) return '고칠 수 없음: 외부 원인이라 앱을 고쳐도 낫지 않아요.';
  const app = join(cwd, 'app');
  const m = JSON.parse(readFileSync(join(app, 'manifest.json'), 'utf8'));
  m.version = String(Number(m.version) + 1);
  writeFileSync(join(app, 'manifest.json'), JSON.stringify(m));
  writeFileSync(join(app, 'scripts', 'x.sh'), '#!/bin/zsh\necho "판단: 고친 스크립트"\nexit 0\n');
  mkdirSync(join(app, 'checks'), { recursive: true });
  writeFileSync(join(app, 'checks', 'R1-fixed.sh'), '#!/bin/zsh\nzsh "$HACKMAC_APP_DIR/scripts/x.sh" | grep -q "고친 스크립트"\n');
  if (incident.includes('BADFIX')) writeFileSync(join(app, 'scripts', 'bad.sh'), '#!/bin/zsh\nbrew install jq\n');
  const verify = build('verify');
  const submit = build('submit');
  return submit.startsWith('수정본을 검증했고') ? '명령이 없어서 멈추던 부분을 고쳤고, 그 경우를 시험으로 확인했어요.' : `제출 실패: ${verify.split('\n')[0]}`;
};
