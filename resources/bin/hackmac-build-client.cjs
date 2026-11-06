// hackmac-build: 제작 에이전트가 HackMac에 진행을 알리고, 평가·검증·설치를 부탁하는 명령.
// resources/bin/hackmac-build(zsh)가 ELECTRON_RUN_AS_NODE=1로 이 파일을 돌린다.
// 요청을 $HACKMAC_BUILD_DIR/inbox/<id>.json에 두고 outbox/<id>.json의 답을 기다린다(modules/build/inbox.ts).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HELP = `사용법: "$HACKMAC_BUILD" <명령> ...

진행 알리기(화면에 그대로 보인다)
  step <1-5> [지금 하는 일]      단계 바꾸기: 1 요구 정리 · 2 가능성 평가 · 3 개발 · 4 자체 검증 · 5 사용자 확인
  now <지금 하는 일>             "지금" 줄 한 줄(쉬운 말)
  req <R번호> <요구사항>          요구사항 추가/고치기. 자동으로 시험할 수 없으면 --manual <이유>
  req-remove <R번호>             요구사항 빼기
  ask <부탁할 일>                사용자가 해야 할 일(권한 승인 등). 확인 필요로 표시된다
  ask-done                       부탁이 끝났음
  fail --type <macos|capability|external|unknown> --needed <무엇이 있었으면 됐나> --evidence <근거> [--evidence <근거>]

HackMac에 부탁하기(끝날 때까지 기다린다)
  evaluate                       요구사항으로 가능성 평가(다른 역할이 판정한다)
  verify                         ./app 패키지 검증(선언·이식성·문법·시험)
  submit                         검증을 통과하면 사용자의 HackMac에 설치
  status                         지금 진행 기록 요약`;

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  console.log(HELP);
  process.exit(cmd ? 0 : 2);
}
const dir = process.env.HACKMAC_BUILD_DIR;
if (!dir) {
  console.error('hackmac-build: HACKMAC_BUILD_DIR가 없어요 — HackMac 작업실 안에서만 쓸 수 있어요');
  process.exit(2);
}

const flag = (name, list) => {
  const out = [];
  for (let i = 0; i < list.length; i++) if (list[i] === name && i + 1 < list.length) out.push(list[++i]);
  return out;
};
const rest = (list, from) => list.slice(from).filter((x, i, a) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--'))).join(' ');

let request;
const TIMEOUT = { event: 15_000, status: 15_000, evaluate: 600_000, verify: 600_000, submit: 600_000 };
switch (cmd) {
  case 'step': request = { cmd: 'event', args: { event: { type: 'step', step: Number(args[1]), now: args.slice(2).join(' ') || undefined } } }; break;
  case 'now': request = { cmd: 'event', args: { event: { type: 'now', text: args.slice(1).join(' ') } } }; break;
  case 'req': {
    const manual = flag('--manual', args);
    request = { cmd: 'event', args: { event: { type: 'req', id: args[1], text: rest(args, 2), ...(manual.length ? { manual: manual[0] } : {}) } } };
    break;
  }
  case 'req-remove': request = { cmd: 'event', args: { event: { type: 'req-remove', id: args[1] } } }; break;
  case 'ask': request = { cmd: 'event', args: { event: { type: 'ask', text: args.slice(1).join(' ') } } }; break;
  case 'ask-done': request = { cmd: 'event', args: { event: { type: 'ask-done' } } }; break;
  case 'fail': request = { cmd: 'event', args: { event: { type: 'fail', failure: flag('--type', args)[0], needed: flag('--needed', args)[0], evidence: flag('--evidence', args) } } }; break;
  case 'evaluate': case 'verify': case 'submit': case 'status': request = { cmd, args: {} }; break;
  default:
    console.error(`hackmac-build: 모르는 명령 '${cmd}'\n\n${HELP}`);
    process.exit(2);
}

const id = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
const inbox = path.join(dir, 'inbox');
const outbox = path.join(dir, 'outbox');
fs.mkdirSync(inbox, { recursive: true });
fs.mkdirSync(outbox, { recursive: true });
const tmp = path.join(inbox, `${id}.json.tmp`);
fs.writeFileSync(tmp, JSON.stringify({ id, ...request }));
fs.renameSync(tmp, path.join(inbox, `${id}.json`));

const answer = path.join(outbox, `${id}.json`);
const limit = TIMEOUT[request.cmd] ?? 15_000;
const t0 = Date.now();
const wait = () => {
  if (fs.existsSync(answer)) {
    let res;
    try { res = JSON.parse(fs.readFileSync(answer, 'utf8')); } catch { setTimeout(wait, 100); return; }
    fs.rmSync(answer, { force: true });
    (res.ok ? process.stdout : process.stderr).write(`${res.text}\n`);
    process.exit(res.ok ? 0 : 1);
  }
  if (Date.now() - t0 > limit) {
    fs.rmSync(path.join(inbox, `${id}.json`), { force: true });
    console.error(`hackmac-build: HackMac이 ${Math.round(limit / 1000)}초 동안 답하지 않았어요 — HackMac이 켜져 있는지 확인해 주세요`);
    process.exit(3);
  }
  setTimeout(wait, 150);
};
wait();
