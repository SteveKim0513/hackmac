// 시험용 가짜 `claude -p --input-format stream-json`. 실제 2.1.x가 내는 줄 모양을 흉내 낸다.
//   보통 글: "echo:<글>"을 두 조각 text_delta로 내고 result
//   "slow": interrupt control_request가 올 때까지 기다린다
//   "die": 코드 3으로 끝난다
//   "tool": tool_use 시작 줄을 낸다
import { createInterface } from 'node:readline';
import { demoBuild, evaluatorReply, fixReply, memoryReply, roleReply } from './demo-build.mjs';

const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
// 계정 폴더(CLAUDE_CONFIG_DIR)가 있으면 그 폴더 안 표시 파일로 로그인 여부를 가른다(추가한 계정). 없으면 기본 계정
const cfg = process.env.CLAUDE_CONFIG_DIR;
const marker = cfg ? `${cfg}/.fake-login` : null;
// `claude auth login`: 주소를 내고 브라우저 코드를 기다린 뒤 표시 파일을 만든다
if (argv[0] === 'auth' && argv[1] === 'login') {
  const { writeFileSync } = await import('node:fs');
  console.log('Opening browser to sign in… https://claude.ai/oauth/authorize?fake=1');
  console.log('Paste code here if prompted >');
  createInterface({ input: process.stdin }).once('line', () => {
    if (marker) writeFileSync(marker, 'x');
    console.log('Login successful');
    process.exit(marker ? 0 : 1);
  });
} else
// `claude auth status --json`: HACKMAC_FAKE_LOGGED_OUT=1이면 (기본 계정이) 로그아웃 상태
if (argv[0] === 'auth' && argv[1] === 'status') {
  const { existsSync } = await import('node:fs');
  const loggedOut = marker ? !existsSync(marker) : process.env.HACKMAC_FAKE_LOGGED_OUT === '1';
  const out = loggedOut
    ? { loggedIn: false, authMethod: 'none' }
    : { loggedIn: true, authMethod: 'claude.ai', email: marker ? 'second@example.com' : 'fake@example.com', orgId: marker ? 'org2' : 'org', subscriptionType: 'max' };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(out.loggedIn ? 0 : 1);
}
if (argv[0] === 'auth') await new Promise(() => {}); // login은 위에서 끝낸다(exit)
if (argv.includes('--resume') && process.env.HACKMAC_FAKE_RESUME_FAIL === '1') { process.stderr.write('No conversation found with session ID\n'); process.exit(1); }
const resume = argv.includes('--resume') ? argv[argv.indexOf('--resume') + 1] : null;
const session = resume ?? 'sess-new';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let inited = false;
let waiting = null;

createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.type === 'control_request' && m.request?.subtype === 'interrupt') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } });
    if (waiting) { waiting = null; out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: session }); }
    return;
  }
  if (m.type !== 'user') return;
  if (!inited) { inited = true; out({ type: 'system', subtype: 'init', session_id: session, args: argv }); }
  const text = m.message.content;
  if (text === 'die') { process.stderr.write('죽음\n'); process.exit(3); }
  if (text === 'slow') { waiting = true; return; }
  if (text === 'tool') out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash' } } });
  const full = evaluatorReply(text) ?? memoryReply(text) ?? fixReply(text) ?? roleReply(text) ?? (text === 'build-demo' ? demoBuild(process.cwd()) : `echo:${text}`);
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: full.slice(0, 5) } } });
  out({ type: 'stream_event', parent_tool_use_id: 'toolu_x', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '팀원 안쪽 글' } } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: full.slice(5) } } });
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1800000000 }, seven_day: { utilization: 72, resetsAt: 1800500000, status: 'allowed_warning' } } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: full, session_id: session });
});
