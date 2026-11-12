// 有料パスを買う・受け取る窓口のテスト。Stripe は呼ばず、差し替えた返事で確かめる（node --test tests/）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { onStatus, onCheckout, onClaim, checkoutForm, returnOrigin, onSale, CHECKOUT_TTL_MIN } from '../functions/api/pass.mjs';
import { verifyPass } from '../functions/_lib/pass.mjs';
const Shop = createRequire(import.meta.url)('../site/shopinfo.js');

const env = { STRIPE_SECRET_KEY: 'sk_test_x', PASS_SIGNING_SECRET: 'test-secret-for-pass-signing' };
const operator = { name: '', tradeName: 'テスト屋', contact: 'shop@example.com' };
const post = (path, body) => new Request('https://shohizei-check.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const SID = 'cs_test_' + 'a'.repeat(30);
const now = 1_800_000_000_000;
const D30 = Shop.PLANS[Shop.PLANS.length - 1]; // いちばん長いパス
const paid = (over = {}, plan = D30) => ({ payment_status: 'paid', currency: 'jpy', amount_total: plan.yen, created: now / 1000 - 60, metadata: { product: Shop.PRODUCT, plan: plan.id }, ...over });
const stripe = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });

test('★売り出しの扉: 販売者の表示は運営者が決めた値。鍵が無い間は売らない', () => {
  // サイトの「運営者情報」に出している物と同じ値。勝手に変えない（変えると特定商取引法の表記が変わる）
  assert.deepEqual(Shop.OPERATOR, { name: '', tradeName: '輸入利益チェッカー 編集室', contact: 'contact@shohizei-check.com' });
  assert.equal(Shop.hasOperator(), true);
  assert.equal(Shop.hasOperator({ contact: '  ' }), false);
  assert.deepEqual(Shop.legalRows({ contact: '' }), []);
  assert.equal(onSale(env), true);
  assert.equal(onSale({}), false);
  assert.equal(onSale({ STRIPE_SECRET_KEY: 'x' }), false);
  assert.equal(onSale({ PASS_SIGNING_SECRET: 'x' }), false);
  assert.equal(onSale(env, { contact: '' }), false);
});

test('表記: 連絡先が入ると行が出る。本名が空なら「請求があれば開示」、屋号だけを販売事業者にしない', () => {
  const rows = Object.fromEntries(Shop.legalRows(operator));
  assert.match(rows['販売事業者'], /請求があれば/);
  assert.equal(rows['屋号'], 'テスト屋');
  assert.equal(rows['メールアドレス'], 'shop@example.com');
  assert.ok(rows['販売価格'].startsWith('有料パス ' + Shop.PLANS.map(Shop.planText).join('、'))); // 後ろに、切り替えの値段が続く
  assert.match(rows['提供時期'], /自動で更新されません/);
  assert.match(Shop.legalNote(operator), /氏名、所在地、電話番号/);
  assert.equal(Object.fromEntries(Shop.legalRows({ ...operator, name: '山田 太郎' }))['販売事業者'], '山田 太郎');
});

test('支払い画面: 値段と日数は定数と同じ。カードだけ。戻り先は自分のサイトだけ', () => {
  const f = checkoutForm('https://shohizei-check.com', now, D30.id);
  assert.equal(f.get('line_items[0][price_data][unit_amount]'), String(D30.yen));
  assert.equal(f.get('metadata[plan]'), D30.id);
  assert.match(f.get('line_items[0][price_data][product_data][name]'), new RegExp('消費税1%チェッカー 有料パス（' + D30.days + '日間）'));
  assert.equal(f.get('line_items[0][price_data][currency]'), 'jpy');
  assert.equal(f.get('allowed_payment_method_types[0]'), 'card');
  assert.equal(f.get('mode'), 'payment');
  assert.equal(f.get('expires_at'), String(now / 1000 + CHECKOUT_TTL_MIN * 60));
  assert.match(f.get('success_url'), /^https:\/\/shohizei-check\.com\/\?session_id=\{CHECKOUT_SESSION_ID\}#pass$/);
  assert.equal(returnOrigin('https://evil.example/api/v1/pass/checkout'), 'https://shohizei-check.com');
  assert.equal(returnOrigin('http://localhost:8792/x'), 'http://localhost:8792');
});

test('買う: 鍵が無い・販売者の表示が無い間は 503。そろえば Stripe のアドレスだけを返す', async () => {
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env: {} }, { operator })).status, 503);
  const closed = await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator: { contact: '' }, now, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) });
  assert.equal(closed.status, 503);
  assert.equal((await closed.json()).error, 'seller_info_missing');
  const ok = await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, now, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).url, 'https://checkout.stripe.com/c/pay/x');
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, now, fetch: stripe({ url: 'https://evil.example/' }) })).status, 502);
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: 'free' }), env }, { operator, now, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) })).status, 400);
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, now, fetch: stripe({ error: { message: 'secret detail' } }, 400) })).status, 502);
});

test('受け取る: 支払い済みなら、期限つきの本物のパスが出る', async () => {
  const res = await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID }), env }, { fetch: stripe(paid()), now });
  assert.equal(res.status, 200);
  const out = await res.json();
  const v = await verifyPass(env.PASS_SIGNING_SECRET, out.token, now);
  assert.equal(v.ok, true);
  assert.equal(v.expiresAt, (now / 1000 - 60) * 1000 + D30.days * 86400000 + CHECKOUT_TTL_MIN * 60000);
  assert.ok(!out.token.includes(SID)); // Stripe の番号はパスに入れない
  // 受け取り直しても同じ期限（延びない）
  const again = await (await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID }), env }, { fetch: stripe(paid()), now: now + 86400000 })).json();
  assert.equal(again.expiresAt, out.expiresAt);
});

test('受け取る: 未払い・額が足りない・別の商品・おかしな番号・期限切れは通さない', async () => {
  const claim = (body, deps) => onClaim({ request: post('/api/v1/pass/claim', body), env }, { now, ...deps });
  assert.equal((await claim({ session_id: SID }, { fetch: stripe(paid({ payment_status: 'unpaid' })) })).status, 402);
  assert.equal((await claim({ session_id: SID }, { fetch: stripe(paid({ amount_total: 1 })) })).status, 402);
  // 定価より1円でも少なければ受け取れない
  assert.equal((await claim({ session_id: SID }, { fetch: stripe(paid({ amount_total: D30.yen - 1 })) })).status, 402);
  assert.equal((await claim({ session_id: SID }, { fetch: stripe(paid({ metadata: { product: Shop.PRODUCT, plan: 'd999' } })) })).status, 402);
  assert.equal((await claim({ session_id: SID }, { fetch: stripe(paid({ currency: 'usd' })) })).status, 402);
  assert.equal((await claim({ session_id: SID }, { fetch: stripe(paid({ metadata: { product: 'other' } })) })).status, 404);
  assert.equal((await claim({ session_id: SID }, { fetch: stripe({}, 404) })).status, 404);
  assert.equal((await claim({ session_id: '../v1/customers' }, { fetch: stripe(paid()) })).status, 400);
  assert.equal((await claim({ session_id: SID }, { fetch: stripe(paid({ created: now / 1000 - (D30.days + 10) * 86400 })) })).status, 410);
  assert.equal((await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID }), env: {} }, { fetch: stripe(paid()) })).status, 503);
});

test('状態: 売り出し中かと値段を返す（鍵は返さない）', async () => {
  const out = await (await onStatus({ request: new Request('https://shohizei-check.com/api/v1/pass/status'), env }, { operator, now })).json();
  assert.deepEqual(out, { onSale: true, freeUntil: '', plans: Shop.PLANS.map((p) => ({ id: p.id, days: p.days, priceYen: p.yen })) });
  assert.equal((await (await onStatus({ request: new Request('https://shohizei-check.com/api/v1/pass/status'), env: {} })).json()).onSale, false);
});

test('★値段: 7日間300円と30日間980円（運営者が決めた値）。7日の代金で30日のパスは受け取れない', async () => {
  assert.deepEqual(Shop.PLANS, [{ id: 'd7', days: 7, yen: 300 }, { id: 'd30', days: 30, yen: 980 }]);
  const D7 = Shop.PLANS[0];
  const res = await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID }), env }, { fetch: stripe(paid({}, D7)), now });
  assert.equal(res.status, 200);
  const v = await verifyPass(env.PASS_SIGNING_SECRET, (await res.json()).token, now);
  assert.equal(v.expiresAt, (now / 1000 - 60) * 1000 + 7 * 86400000 + CHECKOUT_TTL_MIN * 60000);
  const cheat = await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID }), env }, { fetch: stripe(paid({ amount_total: D7.yen })) , now });
  assert.equal(cheat.status, 402);
});

test('★切り替え: 7日間のパスが使える間は、差額だけで30日間へ。期限は最初のお支払いから30日', async () => {
  const [D7, D30b] = Shop.PLANS;
  const diff = D30b.yen - D7.yen;
  assert.equal(diff, 680);
  // まず7日間のパスを受け取る
  const first = await (await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID }), env }, { fetch: stripe(paid({}, D7)), now })).json();
  assert.equal(Shop.planOfToken(first.token), 'd7');
  const up = (token, body = { plan: 'd30', upgrade: true }, at = now) => {
    const req = new Request('https://shohizei-check.com/api/v1/pass/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    let sent = null;
    return onCheckout({ request: req, env }, { operator, now: at, fetch: async (url, init) => { sent = init.body; return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/x' })); } }).then((res) => ({ res, sent }));
  };
  const ok = await up(first.token);
  assert.equal(ok.res.status, 200);
  assert.equal(ok.sent.get('line_items[0][price_data][unit_amount]'), String(diff));
  assert.equal(ok.sent.get('metadata[upgrade_from]'), 'd7');
  const newExpSec = first.expiresAt / 1000 + 23 * 86400;
  assert.equal(ok.sent.get('metadata[upgrade_exp]'), String(newExpSec));
  // パスが無い・にせ物・期限切れ・もう30日間のパス、では切り替えられない
  assert.equal((await up('')).res.status, 409);
  assert.equal((await up(first.token.slice(0, -3) + 'abc')).res.status, 409);
  assert.equal((await up(first.token, undefined, now + 8 * 86400000)).res.status, 409);
  const long = await (await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID }), env }, { fetch: stripe(paid()), now })).json();
  assert.equal((await up(long.token)).res.status, 409);
  // 受け取る: 差額を払っていれば、30日間のパス。期限は最初のお支払いから数える
  const upMeta = { product: Shop.PRODUCT, plan: 'd30', upgrade_from: 'd7', upgrade_exp: String(newExpSec) };
  const SID2 = 'cs_test_' + 'b'.repeat(30);
  const got = await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID2 }), env }, { fetch: stripe(paid({ amount_total: diff, metadata: upMeta })), now: now + 3 * 86400000 });
  assert.equal(got.status, 200);
  const out = await got.json();
  assert.equal(out.expiresAt, newExpSec * 1000);
  assert.equal(Shop.planOfToken(out.token), 'd30');
  assert.equal((await verifyPass(env.PASS_SIGNING_SECRET, out.token, now + 20 * 86400000)).ok, true);
  // 差額より少ない額・切り替えの印なしで差額だけ、は通さない
  assert.equal((await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID2 }), env }, { fetch: stripe(paid({ amount_total: diff - 1, metadata: upMeta })), now })).status, 402);
  assert.equal((await onClaim({ request: post('/api/v1/pass/claim', { session_id: SID2 }), env }, { fetch: stripe(paid({ amount_total: diff })), now })).status, 402);
  // 表記にも書く
  assert.match(Object.fromEntries(Shop.legalRows(operator))['販売価格'], /差額の680円（税込）で30日間に切り替えられます/);
});

test('★無料開放の間は、パスを売らない（無料の物を売らない）。終われば売る', async () => {
  const free = Date.parse('2026-11-20T03:00:00Z');
  const st = await (await onStatus({ request: new Request('https://shohizei-check.com/api/v1/pass/status'), env }, { operator, now: free })).json();
  assert.equal(st.onSale, false);
  assert.equal(st.freeUntil, '2026-11-30');
  const buy = await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, now: free, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) });
  assert.equal(buy.status, 503);
  assert.equal((await buy.json()).error, 'free_period');
  const after = Date.parse('2026-11-30T15:00:00Z');
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, now: after, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) })).status, 200);
});
