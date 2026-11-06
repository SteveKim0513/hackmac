/**
 * 진행 중인 대화를 다른 계정에서 이어 열려면(계획서 6.2) 그 세션 기록을 새 계정의 설정 폴더로 복사해야 한다:
 * `--resume`/`thread/resume`은 자기 설정 폴더 안의 세션만 찾는다. 원본은 지우지 않는다(되돌릴 수 있게).
 *
 *   Claude: <설정폴더>/projects/<작업경로를 이름으로 바꾼 폴더>/<세션>.jsonl  (+ 있으면 <세션>/ 폴더: 도구 결과 등)
 *           폴더 이름 규칙을 가정하지 않고, 원본에서 그 세션 파일이 든 폴더 이름을 그대로 쓴다.
 *   Codex:  <설정폴더>/sessions/YYYY/MM/DD/rollout-<시각>-<세션>.jsonl — 같은 상대경로로 복사
 *           (설정 폴더의 session_index·sqlite 상태 파일은 복사하지 않는다: 새 계정이 자기 것을 만든다.
 *            그것 없이 이어 열리는지는 실제 두 번째 계정으로 확인하지 못했다 → 열기에 실패하면 새 대화로 시작한다, studio/chat.ts)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Vendor } from './cli.ts';

const SESSION_RE = /^[0-9a-zA-Z-]{8,64}$/;

export type CopyResult = { ok: true; copied: string[] } | { ok: false; reason: 'no-source' | 'bad-session'; detail: string };

const findClaude = (cfg: string, session: string): { projectDir: string } | null => {
  const projects = join(cfg, 'projects');
  if (!existsSync(projects)) return null;
  for (const d of readdirSync(projects)) {
    if (existsSync(join(projects, d, `${session}.jsonl`))) return { projectDir: d };
  }
  return null;
};

const findCodex = (cfg: string, session: string): string | null => {
  const root = join(cfg, 'sessions');
  const walk = (dir: string): string | null => {
    if (!existsSync(dir)) return null;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (e.name.startsWith('rollout-') && e.name.endsWith(`-${session}.jsonl`)) return p;
    }
    return null;
  };
  return walk(root);
};

export function copySession(vendor: Vendor, fromCfg: string, toCfg: string, session: string): CopyResult {
  if (!SESSION_RE.test(session)) return { ok: false, reason: 'bad-session', detail: '세션 번호 모양이 이상해요' };
  if (vendor === 'claude') {
    const hit = findClaude(fromCfg, session);
    if (!hit) return { ok: false, reason: 'no-source', detail: `${fromCfg}/projects 안에 세션 ${session} 기록이 없어요` };
    const copied: string[] = [];
    const destDir = join(toCfg, 'projects', hit.projectDir);
    mkdirSync(destDir, { recursive: true });
    cpSync(join(fromCfg, 'projects', hit.projectDir, `${session}.jsonl`), join(destDir, `${session}.jsonl`));
    copied.push(`${session}.jsonl`);
    const side = join(fromCfg, 'projects', hit.projectDir, session);
    if (existsSync(side) && statSync(side).isDirectory()) {
      cpSync(side, join(destDir, session), { recursive: true });
      copied.push(`${session}/`);
    }
    return { ok: true, copied };
  }
  const src = findCodex(fromCfg, session);
  if (!src) return { ok: false, reason: 'no-source', detail: `${fromCfg}/sessions 안에 세션 ${session} 기록이 없어요` };
  const rel = src.slice(join(fromCfg, 'sessions').length + 1);
  const dest = join(toCfg, 'sessions', rel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
  return { ok: true, copied: [rel] };
}
