import fs from 'node:fs';
import path from 'node:path';
import type { ServiceShortcut } from '../shared/types';

// A shortcut's metadata lives inside the script itself as directive
// comments, so the .sh file is the single source of truth for its own
// name/hotkey/description — same pattern as mac-shortcut-manager's
// `@msm-*` headers, renamed to `@svc-*` for this app.
type DirectiveKey = 'name' | 'hotkey' | 'description';
const DIRECTIVE_RE = /^#\s*@svc-(name|hotkey|description):\s*(.*?)\s*$/;
const HEADER_LINES = 30;

export function parseServiceScript(filePath: string): ServiceShortcut {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').slice(0, HEADER_LINES);
  const fields: Partial<Record<DirectiveKey, string>> = {};
  for (const line of lines) {
    const match = DIRECTIVE_RE.exec(line);
    if (match) fields[match[1] as DirectiveKey] = match[2];
  }
  const fallbackName = path.basename(filePath).replace(/\.sh$/, '');
  return {
    id: filePath,
    scriptPath: filePath,
    name: fields.name?.trim() || fallbackName,
    hotkey: fields.hotkey?.trim() || null,
    description: fields.description?.trim() || null,
    hotkeyError: null,
  };
}
