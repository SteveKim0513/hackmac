/**
 * v1 서비스(resources/services/<id>/manifest.json + scripts/*.sh의 @svc-* 헤더)를 v2 앱 패키지로 바꾼다.
 * 한 번 쓰고 버릴 변환이 아니라, v1 번들 서비스를 v2 보관소에 "기본 앱"으로 넣는 길이다.
 *
 * 바뀌는 것(docs/hackmac-v2-manifest.md 5절):
 *  - id: `gtd-reminders` → `hackmac.gtd-reminders` (작성자 hackmac)
 *  - @svc-hotkey는 버린다. 자리는 HackMac이 배정한다. key는 파일 이름에서(`01-register.sh` → `register`)
 *  - 카피 속 "(Alt+1)" 같은 키 조합은 그 키를 쓰던 트리거의 `{hotkey:<key>}`로 바꾼다
 *  - 권한: 스크립트의 `tell application "X"`를 훑어 automation에 넣는다
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AppManifest, HotkeyTrigger } from '../../shared/manifest.ts';

const DIRECTIVE_RE = /^#\s*@svc-(name|hotkey|description):\s*(.*?)\s*$/;
const HEADER_LINES = 30;
const TELL_RE = /tell application "([^"]+)"/g;

interface V1Script { file: string; key: string; name: string; hotkey: string | null; description: string; automation: string[] }

const readScript = (dir: string, file: string): V1Script => {
  const raw = readFileSync(join(dir, file), 'utf8');
  const fields: Record<string, string> = {};
  for (const line of raw.split('\n').slice(0, HEADER_LINES)) {
    const m = DIRECTIVE_RE.exec(line);
    if (m) fields[m[1]] = m[2];
  }
  const key = basename(file, '.sh').replace(/^\d+-/, '');
  const automation = [...new Set([...raw.matchAll(TELL_RE)].map((m) => m[1]))].filter((a) => a !== 'System Events');
  return { file, key, name: fields.name?.trim() || key, hotkey: fields.hotkey?.trim() || null, description: fields.description?.trim() || '', automation };
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 카피에 박힌 "(Alt+1)"을 "({hotkey:register})"로. 어느 키도 아닌 조합은 그대로 두어 검증기가 잡게 한다 */
const replaceHotkeys = (lines: string[], scripts: V1Script[]): string[] => {
  const byHotkey = scripts.filter((s) => s.hotkey).sort((a, b) => b.hotkey!.length - a.hotkey!.length);
  return lines.map((line) => byHotkey.reduce((acc, s) => acc.replace(new RegExp(escapeRe(s.hotkey!), 'g'), `{hotkey:${s.key}}`), line));
};

export interface V1Manifest {
  id: string; name: string; tagline: string; icon: string; accentColor: string;
  whatItIs: string[]; differentiators: string[]; strengths: string[]; usage: string[];
}

export const convertV1 = (serviceDir: string, hackmacMin: string): { manifest: AppManifest; scripts: V1Script[] } => {
  const v1 = JSON.parse(readFileSync(join(serviceDir, 'manifest.json'), 'utf8')) as V1Manifest;
  const scriptsDir = join(serviceDir, 'scripts');
  const scripts = readdirSync(scriptsDir).filter((f) => f.endsWith('.sh')).sort().map((f) => readScript(scriptsDir, f));
  const triggers: HotkeyTrigger[] = scripts.map((s) => ({ kind: 'hotkey', script: `scripts/${s.file}`, key: s.key, name: s.name, description: s.description || s.name }));
  const automation = [...new Set(scripts.flatMap((s) => s.automation))].sort();
  const manifest: AppManifest = {
    schema: 1,
    id: `hackmac.${v1.id}`,
    version: '1',
    author: { name: 'hackmac', signature: null },
    hackmac: { min: hackmacMin },
    name: v1.name,
    icon: v1.icon,
    accentColor: v1.accentColor,
    tagline: replaceHotkeys([v1.tagline], scripts)[0],
    whatItIs: replaceHotkeys(v1.whatItIs, scripts),
    differentiators: replaceHotkeys(v1.differentiators, scripts),
    strengths: replaceHotkeys(v1.strengths, scripts),
    usage: replaceHotkeys(v1.usage, scripts),
    triggers,
    capabilities: { popup: '>=1' },
    permissions: { network: [], automation, accessibility: false, fullDiskAccess: false },
    settings: [],
    secrets: [],
    references: [],
  };
  return { manifest, scripts };
};

/** v1 서비스 폴더 → v2 패키지 폴더(outDir)에 manifest.json + scripts/ 를 쓴다 */
export const writeV2Package = (serviceDir: string, outDir: string, hackmacMin: string): AppManifest => {
  const { manifest } = convertV1(serviceDir, hackmacMin);
  mkdirSync(outDir, { recursive: true });
  cpSync(join(serviceDir, 'scripts'), join(outDir, 'scripts'), { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
};
