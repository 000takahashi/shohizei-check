// 有料のパス（買った印）を作る・確かめる。
// 形: v1.<期限の秒>.<でたらめなID>.<署名>。名前・メール・カードは入れない。
// 署名は HMAC-SHA256（鍵は Worker の秘密の値 PASS_SIGNING_SECRET）。鍵が無ければ、どの印も通さない。
const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

// 長さと中身で時間が変わらない比べ方
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPass(secret, expiresAtSec, id) {
  if (!secret) throw new Error('PASS_SIGNING_SECRET is not set.');
  const body = `v1.${Math.floor(expiresAtSec)}.${String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}`;
  return `${body}.${await hmac(secret, body)}`;
}

// 通れば { ok: true, expiresAt }、だめなら { ok: false, reason }
export async function verifyPass(secret, token, nowMs = Date.now()) {
  if (!secret) return { ok: false, reason: 'not_on_sale' };
  const m = /^(v1\.(\d{1,12})\.[A-Za-z0-9_-]{1,40})\.([A-Za-z0-9_-]{20,80})$/.exec(String(token || '').slice(0, 200));
  if (!m) return { ok: false, reason: 'no_pass' };
  if (!sameText(await hmac(secret, m[1]), m[3])) return { ok: false, reason: 'bad_pass' };
  const expiresAt = Number(m[2]) * 1000;
  if (expiresAt <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, expiresAt };
}

// Authorization: Bearer <印> から印を取り出す
export function bearer(request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  return m ? m[1] : '';
}
