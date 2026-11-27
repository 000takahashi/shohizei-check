// 控えが無い時の取り戻し: 支払いのメールアドレスに、30分だけ使えるリンクを送る。
// 3サイトで同じファイル（直す時はそろえる）。こちらのサーバーは何も保存しない。
// リンクの印: r1.<期限の秒>.<支払い画面の番号>.<署名>。署名は PASS_SIGNING_SECRET の HMAC（パスとは頭の文字で区別する）。
// 送るのは Resend（https://resend.com）。Worker の秘密の値 RESEND_API_KEY がある時だけ送る。
// 送り元は「チェッカー編集室 <pass@サイトのドメイン>」（Resend でそのドメインを確かめておく）。変える時は変数 MAIL_FROM。
export const LINK_TTL_MIN = 30;
export const RESEND_GAP_MIN = 10; // 同じ支払いに続けて送らない間隔
export const MAX_LINKS = 10; // 1つの支払いに送るリンクの上限（いたずらで送り続けられないように）
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

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function mailOn(env) {
  return !!(env && env.RESEND_API_KEY);
}

export function mailFrom(env, site) {
  const v = String((env && env.MAIL_FROM) || '');
  if (/^[^<>\r\n]{0,80}<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/.test(v)) return v;
  return `チェッカー編集室 <pass@${new URL(site).hostname}>`;
}

export async function signLink(secret, sid, expSec) {
  if (!secret) throw new Error('PASS_SIGNING_SECRET is not set.');
  const body = `r1.${Math.floor(expSec)}.${sid}`;
  return `${body}.${await hmac(secret, body)}`;
}

// 通れば { ok: true, sid }、だめなら { ok: false, reason: 'bad' | 'expired' }
export async function verifyLink(secret, token, nowMs = Date.now()) {
  if (!secret) return { ok: false, reason: 'bad' };
  const m = /^(r1\.(\d{1,12})\.(cs_(?:test|live)_[A-Za-z0-9]{10,200}))\.([A-Za-z0-9_-]{20,80})$/.exec(String(token || '').slice(0, 400));
  if (!m) return { ok: false, reason: 'bad' };
  if (!sameText(await hmac(secret, m[1]), m[4])) return { ok: false, reason: 'bad' };
  if (Number(m[2]) * 1000 <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, sid: m[3] };
}

// 送る。{ ok }。失敗しても中身（あて先など）はログに出さない
export async function sendMail(env, deps, { from, to, subject, text }) {
  try {
    const res = await (deps.fetch || fetch)('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    return { ok: res.ok };
  } catch (e) {
    return { ok: false };
  }
}

export function linkMail(siteName, url, en = false) {
  if (en) {
    return {
      subject: `${siteName}: your pass recovery link`,
      text: `Open this link on the device where you want to use your pass:\n${url}\n\nThe link works for ${LINK_TTL_MIN} minutes. One pass can be used on up to 3 devices.\nIf you did not ask for this, you can ignore this email. Nothing changes unless the link is opened.\n\n${siteName}`,
    };
  }
  return {
    subject: `【${siteName}】パスを取り戻すリンク`,
    text: `パスを使いたい端末で、次のリンクを開いてください。\n${url}\n\nこのリンクは${LINK_TTL_MIN}分だけ使えます。1つのパスは、3台の端末まで使えます。\nお心当たりが無い場合は、このメールは捨ててください。リンクを開かない限り、何も変わりません。\n\n${siteName}`,
  };
}
