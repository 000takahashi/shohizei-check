// 有料パスを買う（Stripe Checkout）・受け取る。
//   GET  /api/v1/pass/status    売り出し中か・値段・日数
//   POST /api/v1/pass/checkout  Stripe の支払い画面のアドレスを返す
//        { plan, upgrade: true } といまのパス（Authorization: Bearer）→ 差額だけで長いパスへ切り替える
//   POST /api/v1/pass/claim     { session_id } → 支払い済みなら、署名つきのパスを返す
// 登録もデータベースも無い。支払い済みかは Stripe に聞く。パスは期限入りの印で、名前・メール・カードは入れない。
// 鍵は Worker の秘密の値: STRIPE_SECRET_KEY・PASS_SIGNING_SECRET。どちらかが無い間と、販売者の表示が無い間は売らない（503）。
import Shop from '../../site/shopinfo.js';
import { json, readJson, SITE } from '../_lib/http.mjs';
import { signPass, verifyPass, bearer } from '../_lib/pass.mjs';

const STRIPE = 'https://api.stripe.com/v1';
export const CHECKOUT_TTL_MIN = 35; // 支払い画面が開いている時間。パスはこの分を足して「お支払いから30日」を守る
const RETURN_ORIGINS = [SITE, 'https://www.shohizei-check.com', 'http://localhost:8792'];

// Stripe から戻る先。Host をそのまま信じない（にせの Host で、払った人のパスを別の所へ渡させない）
export function returnOrigin(reqUrl) {
  let origin = '';
  try { origin = new URL(reqUrl).origin; } catch (e) { /* 下で既定に */ }
  return RETURN_ORIGINS.includes(origin) ? origin : SITE;
}

export function onSale(env, operator) {
  return !!(env.STRIPE_SECRET_KEY && env.PASS_SIGNING_SECRET && Shop.hasOperator(operator));
}

// 支払い画面の中身。値段と日数は画面と同じ定数（Shop.PLANS）から。知らないパスの名前は、いちばん上のパスにする
// up（切り替え）= { from, yen, expSec }: 払うのは差額。期限は、最初のお支払いから数えた長いパスの日数（expSec）
export function checkoutForm(origin, now = Date.now(), planId = '', up = null) {
  const P = Shop.planById(planId) || Shop.PLANS[0];
  const f = new URLSearchParams();
  f.set('mode', 'payment');
  f.set('allowed_payment_method_types[0]', 'card'); // その場で確定する支払いだけ（コンビニ払いは「すぐ使える」が嘘になる）
  f.set('expires_at', String(Math.floor(now / 1000) + CHECKOUT_TTL_MIN * 60));
  f.set('line_items[0][quantity]', '1');
  f.set('line_items[0][price_data][currency]', 'jpy');
  f.set('line_items[0][price_data][unit_amount]', String(up ? up.yen : P.yen));
  f.set('line_items[0][price_data][product_data][name]', up ? `消費税1%チェッカー 有料パス（${up.from.days}日間から${P.days}日間への切り替え）` : `消費税1%チェッカー 有料パス（${P.days}日間）`);
  f.set('line_items[0][price_data][product_data][description]', up ? `いまのパスの期限が、最初のお支払いの時から${P.days}日間に延びます。自動で更新されません。` : `お支払いの時から${P.days}日間、有料の機能が使えます。自動で更新されません。`);
  f.set('custom_text[submit][message]', `お支払いの後のキャンセル・返金はできません。自動で更新されません。[特定商取引法に基づく表記](${origin}/#legal)`);
  f.set('metadata[product]', Shop.PRODUCT);
  f.set('metadata[plan]', P.id);
  if (up) { f.set('metadata[upgrade_from]', up.from.id); f.set('metadata[upgrade_exp]', String(Math.floor(up.expSec))); }
  f.set('locale', 'ja');
  f.set('success_url', `${origin}/?session_id={CHECKOUT_SESSION_ID}#pass`);
  f.set('cancel_url', `${origin}/#pass`);
  return f;
}

async function sha16(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let s = '';
  for (const b of d) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 16);
}


export async function onStatus(context, deps = {}) {
  const { request, env } = context;
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405, { Allow: 'GET' });
  return json({ onSale: onSale(env, deps.operator), plans: Shop.PLANS.map((p) => ({ id: p.id, days: p.days, priceYen: p.yen })) });
}

export async function onCheckout(context, deps = {}) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  if (!(env.STRIPE_SECRET_KEY && env.PASS_SIGNING_SECRET)) return json({ error: 'pass_not_configured', message: 'まだ売り出していません。' }, 503);
  if (!Shop.hasOperator(deps.operator)) return json({ error: 'seller_info_missing', message: 'まだ売り出していません。' }, 503); // 表記が先
  const read = await readJson(request, 2000);
  const planId = read.body && typeof read.body.plan === 'string' ? read.body.plan : '';
  if (!Shop.planById(planId)) return json({ error: 'unknown_plan' }, 400);
  // 切り替え: いまのパスが本物で、期限の内で、短い方のパスの時だけ。払うのは差額
  let up = null;
  if (read.body && read.body.upgrade === true) {
    const v = await verifyPass(env.PASS_SIGNING_SECRET, bearer(request), deps.now || Date.now());
    const u = v.ok ? Shop.upgradeFrom(Shop.planOfToken(`v1.0.${v.id}`)) : null;
    if (!u || u.to.id !== planId) return json({ error: 'cannot_upgrade', message: '切り替えられるパスがありません。' }, 409);
    up = { from: u.from, yen: u.yen, expSec: v.expiresAt / 1000 + u.addDays * 86400 };
  }
  try {
    const res = await (deps.fetch || fetch)(`${STRIPE}/checkout/sessions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: checkoutForm(returnOrigin(request.url), deps.now || Date.now(), planId, up),
    });
    if (!res.ok) return json({ error: 'checkout_failed' }, 502); // Stripe の返事はそのまま出さない
    const s = await res.json();
    if (!s.url || !String(s.url).startsWith('https://checkout.stripe.com/')) return json({ error: 'checkout_failed' }, 502);
    return json({ url: s.url });
  } catch (e) {
    return json({ error: 'checkout_failed' }, 502);
  }
}

export async function onClaim(context, deps = {}) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  if (!(env.STRIPE_SECRET_KEY && env.PASS_SIGNING_SECRET)) return json({ error: 'pass_not_configured' }, 503);
  const read = await readJson(request, 2000);
  if (read.error) return json({ error: read.error }, read.status);
  const sid = read.body && typeof read.body.session_id === 'string' ? read.body.session_id : '';
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) return json({ error: 'bad_session' }, 400);
  let s;
  try {
    const res = await (deps.fetch || fetch)(`${STRIPE}/checkout/sessions/${sid}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    if (res.status === 404) return json({ error: 'unknown_session' }, 404);
    if (!res.ok) return json({ error: 'claim_failed' }, 502);
    s = await res.json();
  } catch (e) {
    return json({ error: 'claim_failed' }, 502);
  }
  const meta = s.metadata || {};
  if (meta.product !== Shop.PRODUCT) return json({ error: 'unknown_session' }, 404);
  // どのパスかは、支払い画面を作った時に書いた名前で決める。払った額がそのパスの定価と同じ時だけ渡す
  // （値引きも別の通貨も無い。500円を払って30日のパスを受け取ることはできない）
  const plan = Shop.planById(meta.plan);
  // 切り替えの時は、差額を払っていること。期限は、支払い画面を作った時に書いた値（最初のお支払いから数えた日数）
  const u = meta.upgrade_from ? Shop.upgradeFrom(meta.upgrade_from) : null;
  if (meta.upgrade_from && (!u || !plan || u.to.id !== plan.id)) return json({ error: 'not_paid' }, 402);
  const price = u ? u.yen : plan && plan.yen;
  if (!plan || s.payment_status !== 'paid' || s.currency !== 'jpy' || s.amount_total !== price) return json({ error: 'not_paid' }, 402);
  const days = plan.days;
  // 支払い画面を開いた時から数える（受け取り直しても延びない）。支払いはその後35分以内なので、その分を足す
  const expMs = u ? (Number(meta.upgrade_exp) || 0) * 1000 : (Number(s.created) || 0) * 1000 + days * 86400000 + CHECKOUT_TTL_MIN * 60000;
  const now = deps.now || Date.now();
  if (expMs <= now) return json({ error: 'pass_expired' }, 410);
  return json({ token: await signPass(env.PASS_SIGNING_SECRET, expMs / 1000, `${plan.id}-${await sha16(sid)}`), expiresAt: expMs, days, plan: plan.id });
}
