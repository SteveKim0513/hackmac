/**
 * 앱 비밀값(API 키 등) 보관. 설정(settings.json)과 달리 값을 암호화해서 둔다 — 파일이 유출·백업돼도 키가 그대로 읽히지 않게.
 * 암호화는 주입받는다: Electron에서는 safeStorage(macOS 키체인이 키를 쥔다), 시험에서는 가짜.
 * 암호화를 쓸 수 없으면 평문으로 내려가지 않고 저장을 거절한다(조용히 약하게 저장하지 않는다).
 * 앱 파일 내보내기(.hackapp)에는 들어가지 않는다 — 앱 패키지 폴더 밖에 있다.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SecretCrypto {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(cipher: Buffer): string;
}

/** appId → key → base64(암호문) */
type Data = { schema: 1; items: Record<string, Record<string, string>> };

export class SecretStore {
  private data: Data = { schema: 1, items: {} };

  constructor(private readonly path: string, private readonly crypto: SecretCrypto) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Data>;
        if (raw && typeof raw.items === 'object' && raw.items !== null) this.data = { schema: 1, items: raw.items as Data['items'] };
      } catch {
        // 못 읽는 파일은 덮어쓰지 않고 그대로 둔 채 빈 상태로 시작한다(다음 저장 때 새로 쓴다)
        this.data = { schema: 1, items: {} };
      }
    }
  }

  has(appId: string, key: string): boolean {
    return this.data.items[appId]?.[key] !== undefined;
  }

  set(appId: string, key: string, value: string): { ok: true } | { ok: false; error: string } {
    if (!this.crypto.available()) return { ok: false, error: '이 Mac에서 비밀값을 안전하게 저장할 수 없어요(키체인 사용 불가)' };
    const cipher = this.crypto.encrypt(value).toString('base64');
    this.data.items[appId] = { ...(this.data.items[appId] ?? {}), [key]: cipher };
    this.flush();
    return { ok: true };
  }

  clear(appId: string, key: string): void {
    const cur = this.data.items[appId];
    if (!cur || cur[key] === undefined) return;
    const { [key]: _gone, ...rest } = cur;
    if (Object.keys(rest).length) this.data.items[appId] = rest;
    else delete this.data.items[appId];
    this.flush();
  }

  /** 앱을 지울 때 */
  clearApp(appId: string): void {
    if (this.data.items[appId] === undefined) return;
    delete this.data.items[appId];
    this.flush();
  }

  /** 스크립트 env로 줄 값들. 복호화할 수 없는 항목은 건너뛴다 */
  values(appId: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!this.crypto.available()) return out;
    for (const [k, c] of Object.entries(this.data.items[appId] ?? {})) {
      try {
        out[k] = this.crypto.decrypt(Buffer.from(c, 'base64'));
      } catch {
        // 다른 사용자·다른 키체인에서 만든 암호문 등
      }
    }
    return out;
  }

  private flush(): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    const fd = openSync(tmp, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
  }
}
