// 시험용 가짜 `claude -p --input-format stream-json`. 실제 2.1.x가 내는 줄 모양을 흉내 낸다.
//   보통 글: "echo:<글>"을 두 조각 text_delta로 내고 result
//   "slow": interrupt control_request가 올 때까지 기다린다
//   "die": 코드 3으로 끝난다
//   "tool": tool_use 시작 줄을 낸다
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
// `claude auth status --json`: HACKMAC_FAKE_LOGGED_OUT=1이면 로그아웃 상태
if (argv[0] === 'auth' && argv[1] === 'status') {
  const out = process.env.HACKMAC_FAKE_LOGGED_OUT === '1'
    ? { loggedIn: false, authMethod: 'none' }
    : { loggedIn: true, authMethod: 'claude.ai', email: 'fake@example.com', orgId: 'org', subscriptionType: 'max' };
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  process.exit(out.loggedIn ? 0 : 1);
}
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
  const full = `echo:${text}`;
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: full.slice(0, 5) } } });
  out({ type: 'stream_event', parent_tool_use_id: 'toolu_x', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '팀원 안쪽 글' } } });
  out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: full.slice(5) } } });
  out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 1800000000 }, seven_day: { utilization: 72, resetsAt: 1800500000, status: 'allowed_warning' } } } });
  out({ type: 'result', subtype: 'success', is_error: false, result: full, session_id: session });
});
