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
  assert.equal(rows['販売価格'], '有料パス ' + Shop.PLANS.map(Shop.planText).join('、'));
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
  const closed = await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator: { contact: '' }, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) });
  assert.equal(closed.status, 503);
  assert.equal((await closed.json()).error, 'seller_info_missing');
  const ok = await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).url, 'https://checkout.stripe.com/c/pay/x');
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, fetch: stripe({ url: 'https://evil.example/' }) })).status, 502);
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: 'free' }), env }, { operator, fetch: stripe({ url: 'https://checkout.stripe.com/c/pay/x' }) })).status, 400);
  assert.equal((await onCheckout({ request: post('/api/v1/pass/checkout', { plan: D30.id }), env }, { operator, fetch: stripe({ error: { message: 'secret detail' } }, 400) })).status, 502);
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
  const out = await (await onStatus({ request: new Request('https://shohizei-check.com/api/v1/pass/status'), env }, { operator })).json();
  assert.deepEqual(out, { onSale: true, plans: Shop.PLANS.map((p) => ({ id: p.id, days: p.days, priceYen: p.yen })) });
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
