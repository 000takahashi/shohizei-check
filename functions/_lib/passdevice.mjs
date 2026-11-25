// 有料パスを使える端末の数（3台まで）と、控えが無い時の取り戻し。
// 端末の数は、Stripe の支払い（PaymentIntent）の metadata[devices] に、端末ごとのでたらめな番号を並べて覚える。
// こちらのサーバーは何も保存しない。名前・メール・カードは覚えない（取り戻しの時に Stripe に聞くだけ）。
// 運営者が数を戻したい時は、Stripe の管理画面でその支払いの metadata の devices を消す。
export const MAX_DEVICES = 3;
export const MAX_RECOVER_FAILS = 10; // 同じメールあての支払いで、カードの下4桁を外した回数がこれを超えたら止める
const STRIPE = 'https://api.stripe.com/v1';

// 端末の番号: 英数字と - _ だけ、8〜32文字。それ以外は空
export function cleanDevice(v) {
  const s = typeof v === 'string' ? v : '';
  return /^[A-Za-z0-9_-]{8,32}$/.test(s) ? s : '';
}

export function deviceList(meta) {
  return String((meta && meta.devices) || '').split(',').map((s) => cleanDevice(s)).filter(Boolean);
}

// 足せるか。{ ok, list, changed }
export function addDevice(list, dev, max = MAX_DEVICES) {
  if (list.includes(dev)) return { ok: true, list, changed: false };
  if (list.length >= max) return { ok: false, list, changed: false };
  return { ok: true, list: [...list, dev], changed: true };
}

export async function stripeGet(env, deps, path) {
  const res = await (deps.fetch || fetch)(`${STRIPE}${path}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  return res;
}

async function setMeta(env, deps, piId, fields) {
  const f = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) f.set(`metadata[${k}]`, String(v));
  try {
    const res = await (deps.fetch || fetch)(`${STRIPE}/payment_intents/${encodeURIComponent(piId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: f,
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// この端末を支払いに結びつける。3台を超える時だけ断る。
// Stripe に書けなかった時は、払った方を止めない（数えられないだけ）
export async function bindDevice(env, deps, pi, dev) {
  const r = addDevice(deviceList(pi.metadata), dev);
  if (!r.ok) return { ok: false };
  if (r.changed) await setMeta(env, deps, pi.id, { devices: r.list.join(',') });
  return { ok: true, count: r.list.length };
}

// 支払いの領収書のアドレス（Stripe の領収書のページだけ）
export function receiptUrl(pi) {
  const ch = pi && typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge : null;
  const u = ch && typeof ch.receipt_url === 'string' ? ch.receipt_url : '';
  return /^https:\/\/pay\.stripe\.com\/receipts\//.test(u) ? u : '';
}

export function cardLast4(pi) {
  const ch = pi && typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge : null;
  const c = ch && ch.payment_method_details && ch.payment_method_details.card;
  return c && /^\d{4}$/.test(String(c.last4 || '')) ? String(c.last4) : '';
}

export function piIdOk(v) { return /^pi_[A-Za-z0-9]{8,40}$/.test(String(v || '')); }

// 取り戻し: メールでその商品の支払いを探す。下4桁が合う支払いを返す。
// 外れた時は、そのメールの支払いそれぞれに外した回数を足す。回数を超えた支払いは、合っていても返さない
export async function findForRecovery(env, deps, product, email, last4) {
  const q = new URLSearchParams();
  q.set('customer_details[email]', email);
  q.set('status', 'complete');
  q.set('limit', '20');
  q.append('expand[]', 'data.payment_intent.latest_charge');
  const res = await stripeGet(env, deps, `/checkout/sessions?${q}`);
  if (!res.ok) return { error: 'lookup_failed' };
  const body = await res.json();
  const list = (Array.isArray(body.data) ? body.data : []).filter((s) => s && s.metadata && s.metadata.product === product && s.payment_status === 'paid' && s.payment_intent && typeof s.payment_intent === 'object' && piIdOk(s.payment_intent.id));
  if (!list.length) return { found: [] };
  const fails = (s) => Number((s.payment_intent.metadata || {}).recover_fails) || 0;
  if (list.some((s) => fails(s) >= MAX_RECOVER_FAILS)) return { locked: true };
  const found = list.filter((s) => cardLast4(s.payment_intent) === last4);
  if (!found.length) {
    for (const s of list) await setMeta(env, deps, s.payment_intent.id, { recover_fails: fails(s) + 1 });
  }
  return { found };
}
