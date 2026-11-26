// 有料パスを買う（Stripe Checkout）・受け取る。
//   GET  /api/v1/pass/status    売り出し中か・値段・日数
//   POST /api/v1/pass/checkout  Stripe の支払い画面のアドレスを返す
//        { plan, upgrade: true } といまのパス（Authorization: Bearer）→ 差額だけで長いパスへ切り替える
//   POST /api/v1/pass/claim     { session_id } → 支払い済みなら、署名つきのパスを返す（何度でも同じ期限で受け取り直せる）
//   POST /api/v1/pass/check     Authorization: Bearer <パス> → 本物で期限の内か（控えからパスを戻す時に使う）
//        { device } を付けると、その端末を数える（1つの支払いで3台まで）
//   POST /api/v1/pass/recover   { email, last4, device } → 控えが無い時に、支払いのメールとカードの下4桁でパスを渡す
// 登録もデータベースも無い。支払い済みかは Stripe に聞く。パスは期限入りの印で、名前・メール・カードは入れない。
// 鍵は Worker の秘密の値: STRIPE_SECRET_KEY・PASS_SIGNING_SECRET。どちらかが無い間と、販売者の表示が無い間は売らない（503）。
import Shop from '../../site/shopinfo.js';
import { json, readJson, SITE } from '../_lib/http.mjs';
import { signPass, verifyPass, bearer } from '../_lib/pass.mjs';
import { cleanDevice, bindDevice, receiptUrl, stripeGet, piIdOk, findForRecovery, MAX_DEVICES } from '../_lib/passdevice.mjs';

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
  f.set('line_items[0][price_data][product_data][description]', up ? `現在のパスの有効期限が、最初のお支払いの時点から${P.days}日間に延長されます。自動で更新されません。` : `お支払いの時点から${P.days}日間、有料の機能をご利用いただけます。自動で更新されません。`);
  f.set('custom_text[submit][message]', `お支払い後のキャンセル・返金はお受けいたしかねます。自動で更新されません。[特定商取引法に基づく表記](${origin}/#legal)`);
  f.set('metadata[product]', Shop.PRODUCT);
  f.set('metadata[plan]', P.id);
  // 支払い画面を作った時の額と日数も書いておく（値段を変えた後に、前の値段の支払いを受け取っても断らない）
  f.set('metadata[yen]', String(up ? up.yen : P.yen));
  f.set('metadata[days]', String(P.days));
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
  const free = Shop.freeOpen(deps.now);
  return json({ onSale: !free && onSale(env, deps.operator), freeUntil: free ? Shop.FREE_UNTIL : '', plans: Shop.PLANS.map((p) => ({ id: p.id, days: p.days, priceYen: p.yen })) });
}

export async function onCheckout(context, deps = {}) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  if (!(env.STRIPE_SECRET_KEY && env.PASS_SIGNING_SECRET)) return json({ error: 'pass_not_configured', message: '現在、販売を開始しておりません。' }, 503);
  if (!Shop.hasOperator(deps.operator)) return json({ error: 'seller_info_missing', message: '現在、販売を開始しておりません。' }, 503); // 表記が先
  if (Shop.freeOpen(deps.now)) return json({ error: 'free_period', message: '無料開放の期間中は、パスを販売しておりません。' }, 503); // 無料の物を売らない
  const read = await readJson(request, 2000);
  const planId = read.body && typeof read.body.plan === 'string' ? read.body.plan : '';
  if (!Shop.planById(planId)) return json({ error: 'unknown_plan' }, 400);
  // 切り替え: いまのパスが本物で、期限の内で、短い方のパスの時だけ。払うのは差額
  let up = null;
  if (read.body && read.body.upgrade === true) {
    const v = await verifyPass(env.PASS_SIGNING_SECRET, bearer(request), deps.now || Date.now());
    const u = v.ok ? Shop.upgradeFrom(Shop.planOfToken(`v1.0.${v.id}`)) : null;
    if (!u || u.to.id !== planId) return json({ error: 'cannot_upgrade', message: '切り替えられるパスがございません。' }, 409);
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

const LIMIT_MESSAGE = `このパスは、すでに${MAX_DEVICES}台の端末で使われています。お困りの時は、運営者情報のメールアドレスへご連絡ください。`;

// 支払い（Checkout の支払い画面）から、パスを作る。端末が分かる時は、その端末を数える
async function passFromSession(s, sid, env, deps, dev) {
  const meta = s.metadata || {};
  if (meta.product !== Shop.PRODUCT) return [404, { error: 'unknown_session' }];
  // どのパスかは、支払い画面を作った時に書いた名前で決める。払った額がそのパスの定価と同じ時だけ渡す
  // （値引きも別の通貨も無い。500円を払って30日のパスを受け取ることはできない）
  const plan = Shop.planById(meta.plan);
  // 切り替えの時は、差額を払っていること。期限は、支払い画面を作った時に書いた値（最初のお支払いから数えた日数）
  const u = meta.upgrade_from ? Shop.upgradeFrom(meta.upgrade_from) : null;
  if (meta.upgrade_from && (!u || !plan || u.to.id !== plan.id)) return [402, { error: 'not_paid' }];
  // 額と日数は、支払い画面を作った時に書いた値（サーバーだけが書く）。古い支払い画面で書いていない時は、今の定数
  const posInt = (v) => (/^[1-9]\d{0,6}$/.test(String(v || '')) ? Number(v) : 0);
  const price = posInt(meta.yen) || (u ? u.yen : plan && plan.yen);
  if (!plan || s.payment_status !== 'paid' || s.currency !== 'jpy' || s.amount_total !== price) return [402, { error: 'not_paid' }];
  const days = posInt(meta.days) || plan.days;
  // 支払い画面を開いた時から数える（受け取り直しても延びない）。支払いはその後35分以内なので、その分を足す
  const expMs = u ? (Number(meta.upgrade_exp) || 0) * 1000 : (Number(s.created) || 0) * 1000 + days * 86400000 + CHECKOUT_TTL_MIN * 60000;
  const now = deps.now || Date.now();
  if (expMs <= now) return [410, { error: 'pass_expired' }];
  const pi = s.payment_intent && typeof s.payment_intent === 'object' && piIdOk(s.payment_intent.id) ? s.payment_intent : null;
  let id = `${plan.id}-${await sha16(sid)}`;
  if (pi) {
    // 端末を数える。支払いの番号はパスに入れる（控えから戻す時に、どの支払いか分かるように）
    if (!dev) return [400, { error: 'no_device' }];
    const b = await bindDevice(env, deps, pi, dev);
    if (!b.ok) return [403, { error: 'device_limit', message: LIMIT_MESSAGE }];
    id = `${plan.id}-${pi.id}`;
  }
  return [200, { token: await signPass(env.PASS_SIGNING_SECRET, expMs / 1000, id), expiresAt: expMs, days, plan: plan.id, receiptUrl: receiptUrl(pi) }];
}

export async function onClaim(context, deps = {}) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  if (!(env.STRIPE_SECRET_KEY && env.PASS_SIGNING_SECRET)) return json({ error: 'pass_not_configured' }, 503);
  const read = await readJson(request, 2000);
  if (read.error) return json({ error: read.error }, read.status);
  const sid = read.body && typeof read.body.session_id === 'string' ? read.body.session_id : '';
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) return json({ error: 'bad_session' }, 400);
  const dev = cleanDevice(read.body.device);
  let s;
  try {
    const res = await stripeGet(env, deps, `/checkout/sessions/${sid}?expand[]=payment_intent.latest_charge`);
    if (res.status === 404) return json({ error: 'unknown_session' }, 404);
    if (!res.ok) return json({ error: 'claim_failed' }, 502);
    s = await res.json();
  } catch (e) {
    return json({ error: 'claim_failed' }, 502);
  }
  const [status, body] = await passFromSession(s, sid, env, deps, dev);
  return json(body, status);
}

// 控えが無い時: 支払いに使ったメールアドレスと、カードの下4桁でパスを渡す。
// どちらかが違う時は、どちらが違うかを言わない（メールアドレスが使われたかを探られないように）
export async function onRecover(context, deps = {}) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  if (!(env.STRIPE_SECRET_KEY && env.PASS_SIGNING_SECRET)) return json({ error: 'pass_not_configured' }, 503);
  const read = await readJson(request, 2000);
  if (read.error) return json({ error: read.error }, read.status);
  const b = read.body || {};
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const last4 = typeof b.last4 === 'string' ? b.last4.trim() : '';
  const dev = cleanDevice(b.device);
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email) || !/^\d{4}$/.test(last4) || !dev) return json({ error: 'bad_input' }, 400);
  let r;
  try {
    r = await findForRecovery(env, deps, Shop.PRODUCT, email, last4);
  } catch (e) {
    return json({ error: 'recover_failed' }, 502);
  }
  if (r.error) return json({ error: 'recover_failed' }, 502);
  if (r.locked) return json({ error: 'locked' }, 429);
  // 合った支払いのうち、期限がいちばん遅いパスを渡す（切り替えた時は、切り替えた後の支払い）
  let best = null;
  for (const s of r.found) {
    const [status, body] = await passFromSession(s, s.id || 'cs_unknown', env, deps, dev);
    if (status === 403) return json(body, 403);
    if (status === 200 && (!best || body.expiresAt > best.expiresAt)) best = body;
  }
  if (best) return json(best, 200);
  if (r.found.length) return json({ error: 'pass_expired' }, 410);
  return json({ error: 'not_found' }, 404);
}

// 控えから戻すパスが本物で、期限の内かを確かめる。中身（期限）だけ返す
export async function onCheck(context, deps = {}) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  if (!env.PASS_SIGNING_SECRET) return json({ error: 'pass_not_configured' }, 503);
  const v = await verifyPass(env.PASS_SIGNING_SECRET, bearer(request), deps.now || Date.now());
  if (!v.ok) return json({ ok: false, reason: v.reason }, v.reason === 'expired' ? 410 : 401);
  // 控えから別の端末へ戻す時は、その端末を数える（1つの支払いで3台まで）
  const read = await readJson(request, 2000);
  const dev = cleanDevice(read.body && read.body.device);
  const m = /(?:^|-)(pi_[A-Za-z0-9]{8,40})$/.exec(v.id || '');
  let receipt = '';
  if (dev && m && env.STRIPE_SECRET_KEY) {
    try {
      // 領収書のアドレスも一緒にもらう（控えから別の端末に戻した時も、その端末で領収書を開けるように）
      const res = await stripeGet(env, deps, `/payment_intents/${m[1]}?expand[]=latest_charge`);
      if (res.ok) {
        const pi = await res.json();
        const b = await bindDevice(env, deps, pi, dev);
        if (!b.ok) return json({ ok: false, reason: 'device_limit', message: LIMIT_MESSAGE }, 403);
        receipt = receiptUrl(pi);
      }
      // Stripe に聞けない時は、払った方を止めない
    } catch (e) { /* 同上 */ }
  }
  return json(receipt ? { ok: true, expiresAt: v.expiresAt, receiptUrl: receipt } : { ok: true, expiresAt: v.expiresAt });
}
