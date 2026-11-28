// 有料パスの端末の数（3台まで）・控えから戻す時の数え方・控えが無い時の取り戻し・領収書のアドレス
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { onClaim, onCheck, onRecover } from '../functions/api/pass.mjs';
import { verifyPass } from '../functions/_lib/pass.mjs';
import { cleanDevice, addDevice, MAX_DEVICES, MAX_RECOVER_FAILS } from '../functions/_lib/passdevice.mjs';
const Shop = createRequire(import.meta.url)('../site/shopinfo.js');

const env = { STRIPE_SECRET_KEY: 'sk_test_x', PASS_SIGNING_SECRET: 'test-secret-for-pass-signing' };
const now = 1_800_000_000_000;
const SID = 'cs_test_' + 'a'.repeat(30);
const D30 = Shop.PLANS[Shop.PLANS.length - 1];
const DEV = (n) => 'device' + String(n).padStart(6, '0');
const RECEIPT = 'https://pay.stripe.com/receipts/payment/abc';

// 支払いと PaymentIntent を覚える、にせの Stripe
function fakeStripe({ email = 'buyer@example.com', last4 = '4242', meta = {} } = {}) {
  const pi = { id: 'pi_test1234567890', metadata: { ...meta }, latest_charge: { receipt_url: RECEIPT, payment_method_details: { card: { last4 } } } };
  const session = () => ({ id: SID, payment_status: 'paid', currency: 'jpy', amount_total: D30.yen, created: now / 1000 - 60, metadata: { product: Shop.PRODUCT, plan: D30.id }, customer_details: { email }, payment_intent: { ...pi, metadata: { ...pi.metadata } } });
  const calls = [];
  const fetch = async (url, opt = {}) => {
    calls.push({ url: String(url), method: opt.method || 'GET' });
    const u = new URL(String(url));
    if (opt.method === 'POST' && u.pathname === `/v1/payment_intents/${pi.id}`) {
      for (const [k, v] of new URLSearchParams(String(opt.body))) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) pi.metadata[m[1]] = v; }
      return new Response('{}', { status: 200 });
    }
    if (u.pathname === `/v1/payment_intents/${pi.id}`) return new Response(JSON.stringify({ ...pi, metadata: { ...pi.metadata } }), { status: 200 });
    if (u.pathname === `/v1/checkout/sessions/${SID}`) return new Response(JSON.stringify(session()), { status: 200 });
    if (u.pathname === '/v1/checkout/sessions') {
      const data = u.searchParams.get('customer_details[email]') === email ? [session()] : [];
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetch, pi, calls };
}
const post = (path, body, token) => new Request('https://shohizei-check.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body || {}) });
const claim = (st, device) => onClaim({ request: post('/api/v1/pass/claim', { session_id: SID, device }), env }, { fetch: st.fetch, now });

test('端末の番号: 形の違う物は使わない。3台まで足せる', () => {
  assert.equal(cleanDevice('abc'), '');
  assert.equal(cleanDevice('abc def ghi'), '');
  assert.equal(cleanDevice(DEV(1)), DEV(1));
  assert.equal(MAX_DEVICES, 3);
  assert.deepEqual(addDevice([DEV(1)], DEV(1)), { ok: true, list: [DEV(1)], changed: false });
  assert.equal(addDevice([DEV(1), DEV(2), DEV(3)], DEV(4)).ok, false);
});

test('★受け取る: 1つの支払いで3台まで。同じ端末は何度受け取っても1台', async () => {
  const st = fakeStripe();
  for (const n of [1, 1, 2, 3]) assert.equal((await claim(st, DEV(n))).status, 200);
  assert.equal(st.pi.metadata.devices, [DEV(1), DEV(2), DEV(3)].join(','));
  const r = await claim(st, DEV(4));
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.equal(body.error, 'device_limit');
  assert.ok(body.message.includes('3つのブラウザーで登録されています') && !body.message.includes('台'));
  // 端末の番号が無い受け取りは断る（支払いの直後のアドレスを人に渡しても、数えずに使えないように）
  assert.equal((await claim(st, '')).status, 400);
});

test('受け取る: パスには支払いの番号が入り、領収書のアドレスを返す。支払い画面の番号は入れない', async () => {
  const st = fakeStripe();
  const out = await (await claim(st, DEV(1))).json();
  assert.match(out.token, /\.d30-pi_test1234567890\./);
  assert.ok(!out.token.includes(SID));
  assert.equal(out.receiptUrl, RECEIPT);
  assert.equal(Shop.planOfToken(out.token), D30.id); // 切り替えの判定は今までどおり
  assert.equal((await verifyPass(env.PASS_SIGNING_SECRET, out.token, now)).ok, true);
});

test('★控えから戻す: 端末を付けると数える。4台目は断る。端末を付けない確かめは今までどおり', async () => {
  const st = fakeStripe();
  const { token } = await (await claim(st, DEV(1))).json();
  const check = (device) => onCheck({ request: post('/api/v1/pass/check', device ? { device } : {}, token), env }, { fetch: st.fetch, now });
  assert.equal((await check(DEV(2))).status, 200);
  assert.equal((await check(DEV(3))).status, 200);
  assert.equal((await check(DEV(4))).status, 403);
  assert.equal((await check(DEV(2))).status, 200); // もう数えた端末は通る
  assert.equal((await check('')).status, 200);
  // Stripe に聞けない時は、払った方を止めない
  const down = async () => new Response('{}', { status: 500 });
  assert.equal((await onCheck({ request: post('/api/v1/pass/check', { device: DEV(9) }, token), env }, { fetch: down, now })).status, 200);
});

test('★取り戻す: メールと下4桁が合えばパスを渡す。どちらが違っても同じ答え', async () => {
  const st = fakeStripe();
  const rec = (body) => onRecover({ request: post('/api/v1/pass/recover', body), env }, { fetch: st.fetch, now });
  const ok = await rec({ email: ' Buyer@Example.com ', last4: '4242', device: DEV(1) });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal((await verifyPass(env.PASS_SIGNING_SECRET, j.token, now)).ok, true);
  assert.equal(j.receiptUrl, RECEIPT);
  assert.equal((await rec({ email: 'buyer@example.com', last4: '0000', device: DEV(1) })).status, 404);
  assert.equal((await rec({ email: 'other@example.com', last4: '4242', device: DEV(1) })).status, 404);
  assert.equal((await rec({ email: 'buyer@example.com', last4: '42', device: DEV(1) })).status, 400);
  assert.equal((await rec({ email: 'buyer@example.com', last4: '4242' })).status, 400);
  assert.equal((await onRecover({ request: post('/api/v1/pass/recover', {}), env: {} }, { fetch: st.fetch, now })).status, 503);
});

test('取り戻す: 下4桁を外し続けると止まる。取り戻しても台数の上限は同じ', async () => {
  const st = fakeStripe({ meta: { devices: [DEV(1), DEV(2), DEV(3)].join(',') } });
  const rec = (last4, device) => onRecover({ request: post('/api/v1/pass/recover', { email: 'buyer@example.com', last4, device }), env }, { fetch: st.fetch, now });
  assert.equal((await rec('4242', DEV(4))).status, 403);
  assert.equal((await rec('4242', DEV(2))).status, 200);
  for (let i = 0; i < MAX_RECOVER_FAILS; i++) assert.equal((await rec('1111', DEV(2))).status, 404);
  assert.equal((await rec('4242', DEV(2))).status, 429);
});

import * as MOD from '../functions/api/pass.mjs';
const LINKLIB = '../functions/_lib/passmail.mjs';

// ---------- メールで送るリンク（控えが無い時の取り戻し） ----------
test('★リンクを送る: 支払いのメールにだけ送る。見つからなくても答えは同じ。続けて押しても1通', async () => {
  const st = fakeStripe();
  const mails = [];
  const fetchAll = async (url, opt = {}) => {
    if (String(url) === 'https://api.resend.com/emails') { mails.push(JSON.parse(opt.body)); return new Response('{"id":"x"}', { status: 200 }); }
    return st.fetch(url, opt);
  };
  const menv = { ...env, RESEND_API_KEY: 're_test_x' };
  const send = (email, t = now) => MOD.onSendLink({ request: post('/api/v1/pass/send-link', { email }), env: menv }, { fetch: fetchAll, now: t });
  const a = await send(' Buyer@Example.com ');
  assert.equal(a.status, 200);
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ['buyer@example.com']);
  assert.match(mails[0].from, /^チェッカー編集室 <pass@[a-z.-]+\.com>$/);
  const link = decodeURIComponent(/[?&]link=([^#\s]+)/.exec(mails[0].text)[1]);
  const b = await send('other@example.com');
  assert.equal(b.status, 200);
  assert.deepEqual(await a.clone().json(), await b.json());
  assert.equal(mails.length, 1);
  await send('buyer@example.com', now + 60000);
  assert.equal(mails.length, 1);
  await send('buyer@example.com', now + 11 * 60000);
  assert.equal(mails.length, 2);
  // リンクで受け取る
  const take = (l, device, t = now) => MOD.onClaimLink({ request: post('/api/v1/pass/claim-link', { link: l, device }), env }, { fetch: st.fetch, now: t });
  const ok = await take(link, DEV(1));
  assert.equal(ok.status, 200);
  assert.equal((await verifyPass(env.PASS_SIGNING_SECRET, (await ok.json()).token, now)).ok, true);
  assert.equal((await take(link, DEV(1), now + 31 * 60000)).status, 410);
  assert.equal((await take(link.slice(0, -2) + 'xx', DEV(1))).status, 400);
  assert.equal((await take(link, '')).status, 400);
  // メールを送れる時は、メールと下4桁だけの取り戻しは使わない
  assert.equal((await onRecover({ request: post('/api/v1/pass/recover', { email: 'buyer@example.com', last4: '4242', device: DEV(1) }), env: menv }, { fetch: st.fetch, now })).status, 410);
  // 送る設定が無い間は 503
  assert.equal((await MOD.onSendLink({ request: post('/api/v1/pass/send-link', { email: 'buyer@example.com' }), env }, { fetch: fetchAll, now })).status, 503);
});

test('リンクを送る: 4台目の端末はリンクでも断る', async () => {
  const st = fakeStripe({ meta: { devices: [DEV(1), DEV(2), DEV(3)].join(',') } });
  const { signLink } = await import(LINKLIB);
  const l = await signLink(env.PASS_SIGNING_SECRET, SID, now / 1000 + 600);
  const r = await MOD.onClaimLink({ request: post('/api/v1/pass/claim-link', { link: l, device: DEV(4) }), env }, { fetch: st.fetch, now });
  assert.equal(r.status, 403);
});
