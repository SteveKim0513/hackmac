// 시험용 가짜 `codex app-server --listen stdio://`. codex-cli 0.164.0 실측 순서를 흉내 낸다.
//   보통 글: commentary 항목 하나 + final_answer 항목("echo:<글>")을 낸 뒤 turn/completed
//   "approve": 명령 승인 요청을 보내고 답을 받은 뒤 그 decision을 답에 넣는다
//   "slow": turn/interrupt가 올 때까지 기다렸다가 interrupted로 끝낸다
//   "die": 코드 3으로 끝난다
import { createInterface } from 'node:readline';
import { demoBuild, evaluatorReply, fixReply, memoryReply } from './demo-build.mjs';

if (process.argv[2] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }

// 계정 폴더(CODEX_HOME)가 있으면 그 폴더 안 표시 파일로 로그인 여부를 가른다(추가한 계정). 없으면 기본 계정
const home = process.env.CODEX_HOME;
const marker = home ? `${home}/.fake-login` : null;
// `codex login`: 주소를 내고 잠깐 뒤 표시 파일을 만들어 끝낸다(브라우저 콜백을 흉내)
if (process.argv[2] === 'login' && !process.argv[3]) {
  const { writeFileSync } = await import('node:fs');
  console.log('If your browser did not open, navigate to this URL to authenticate: https://auth.openai.com/oauth/authorize?fake=1');
  setTimeout(() => { if (marker) writeFileSync(marker, 'x'); console.log('Successfully logged in'); process.exit(marker ? 0 : 1); }, 300);
  await new Promise(() => {});
}
// `codex login status`: HACKMAC_FAKE_LOGGED_OUT=1이면 (기본 계정이) 로그아웃 상태
if (process.argv[2] === 'login' && process.argv[3] === 'status') {
  const { existsSync } = await import('node:fs');
  const loggedOut = marker ? !existsSync(marker) : process.env.HACKMAC_FAKE_LOGGED_OUT === '1';
  if (loggedOut) { process.stderr.write('Not logged in\n'); process.exit(1); }
  process.stderr.write('Logged in using ChatGPT\n');
  process.exit(0);
}

const out = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const note = (method, params) => out({ method, params });
let thread = null;
let turnN = 0;
let slow = null;
const waitingServer = new Map();

const finish = (turnId, status, items) => note('turn/completed', { threadId: thread, turn: { id: turnId, items, status, error: null } });

const runTurn = async (turnId, text) => {
  note('turn/started', { threadId: thread, turn: { id: turnId, items: [], status: 'inProgress' } });
  if (text === 'die') { process.stderr.write('죽음\n'); process.exit(3); }
  if (text === 'slow') { slow = turnId; return; }
  let answer = evaluatorReply(text) ?? memoryReply(text) ?? fixReply(text) ?? (text === 'build-demo' ? demoBuild(process.cwd()) : `echo:${text}`);
  if (text === 'approve') {
    const decision = await new Promise((resolve) => { waitingServer.set('srv-1', resolve); out({ id: 'srv-1', method: 'item/commandExecution/requestApproval', params: { threadId: thread, turnId, itemId: 'cmd1', command: 'rm -rf /' } }); });
    answer = `decision:${decision.decision}`;
  }
  note('item/started', { threadId: thread, turnId, item: { type: 'agentMessage', id: 'c1', text: '', phase: 'commentary' } });
  note('item/agentMessage/delta', { threadId: thread, turnId, itemId: 'c1', delta: '살펴보는 중' });
  note('item/started', { threadId: thread, turnId, item: { type: 'commandExecution', id: 'x1' } });
  note('item/started', { threadId: thread, turnId, item: { type: 'agentMessage', id: 'a1', text: '', phase: 'final_answer' } });
  note('item/agentMessage/delta', { threadId: thread, turnId, itemId: 'a1', delta: answer.slice(0, 5) });
  note('item/agentMessage/delta', { threadId: thread, turnId, itemId: 'a1', delta: answer.slice(5) });
  note('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1793946175 }, secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 1794460954 } } });
  finish(turnId, 'completed', [{ type: 'agentMessage', id: 'c1', text: '살펴보는 중', phase: 'commentary' }, { type: 'agentMessage', id: 'a1', text: answer, phase: 'final_answer' }]);
};

createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id !== undefined && !m.method) { waitingServer.get(m.id)?.(m.result); waitingServer.delete(m.id); return; }
  if (m.method === 'initialize') return out({ id: m.id, result: { userAgent: 'fake', platformOs: 'macos' } });
  if (m.method === 'initialized') return;
  if (m.method === 'thread/start') { thread = 'thread-new'; return out({ id: m.id, result: { thread: { id: thread, cwd: m.params.cwd }, sandbox: m.params.sandbox, approvalPolicy: m.params.approvalPolicy } }); }
  if (m.method === 'thread/resume') { thread = m.params.threadId; return out({ id: m.id, result: { thread: { id: thread } } }); }
  if (m.method === 'turn/start') {
    const turnId = `turn-${++turnN}`;
    out({ id: m.id, result: { turn: { id: turnId, items: [], status: 'inProgress' } } });
    void runTurn(turnId, m.params.input[0].text);
    return;
  }
  if (m.method === 'turn/interrupt') {
    out({ id: m.id, result: {} });
    if (slow === m.params.turnId) { slow = null; finish(m.params.turnId, 'interrupted', []); }
    return;
  }
  out({ id: m.id, error: { code: -32601, message: `unknown ${m.method}` } });
});
