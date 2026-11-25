// 更新中の画面（src/maintenance.mjs）のテスト（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { MAINTENANCE } from '../src/maintenance.mjs';

const env = { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
const ctx = { waitUntil() {} };
const get = (path, e = env) => worker.fetch(new Request('https://shohizei-check.com' + path), e, ctx);

test('更新中の時、トップと下のページは 503 と Retry-After で「休止中」の画面を返す（noindex は付けない）', { skip: !MAINTENANCE }, async () => {
  for (const p of ['/', '/guide/', '/legal/', '/en/', '/no-such-page']) {
    const res = await get(p);
    assert.equal(res.status, 503, p);
    assert.ok(Number(res.headers.get('Retry-After')) > 0, p);
    assert.equal(res.headers.get('X-Robots-Tag'), null, p);
    const html = await res.text();
    assert.match(html, /公開を休止しております/);
    assert.match(html, /消費税1%チェッカー/);
    assert.match(html, /contact@shohizei-check.com/);
    assert.match(html, /チェッカー編集室/);
    assert.doesNotMatch(html, /noindex/);
  }
});

test('更新中の時、AI 向けの窓口も 503 で休止中の JSON を返す', { skip: !MAINTENANCE }, async () => {
  for (const p of ['/mcp', '/api/v1/compare', '/api/v1/pass/status']) {
    const res = await get(p);
    assert.equal(res.status, 503, p);
    assert.equal((await res.json()).error, 'maintenance', p);
  }
});

test('更新中でも robots.txt・ads.txt・IndexNow の鍵・アイコンはそのまま返す', async () => {
  for (const p of ['/robots.txt', '/ads.txt', '/b3ac2ad7fde88176df4974146937ca7d.txt', '/favicon.svg', '/og.png']) {
    assert.equal((await get(p)).status, 200, p);
  }
});

test('www は更新中でも正式な住所へ転送する', async () => {
  const res = await worker.fetch(new Request('https://www.shohizei-check.com/'), env, ctx);
  assert.equal(res.status, 301);
});

test('止めた時（MAINTENANCE を false にした時と同じ）は、元のページが返る', async () => {
  const res = await get('/', { ...env, MAINTENANCE: 'off' });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'asset');
});

// 運営者だけが見る入口（合言葉の本物はテストに置かない。テスト用の合言葉で確かめる）
import { previewGate, markPreview } from '../src/maintenance.mjs';
import { createHash } from 'node:crypto';
const TKEY = 'test-only-preview-key-0123456789';
const THASH = createHash('sha256').update(TKEY).digest('hex');
const req = (path, cookie) => new Request('https://shohizei-check.com' + path, cookie ? { headers: { Cookie: cookie } } : {});

test('合言葉のリンクを開くと、30日の印を付けて合言葉を外した住所へ戻す', async () => {
  const r = req('/guide/?preview=' + TKEY);
  const g = await previewGate(r, new URL(r.url), THASH);
  assert.equal(g.redirect.status, 302);
  assert.equal(g.redirect.headers.get('Location'), 'https://shohizei-check.com/guide/');
  const c = g.redirect.headers.get('Set-Cookie');
  assert.match(c, /^ck_preview=/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /Max-Age=2592000/);
});

test('印がある人だけ通す。違う合言葉・印なしは通さない', async () => {
  const ok = req('/', 'a=1; ck_preview=' + TKEY);
  assert.equal((await previewGate(ok, new URL(ok.url), THASH)).ok, true);
  const bad = req('/', 'ck_preview=wrong-key-wrong-key-wrong');
  assert.equal((await previewGate(bad, new URL(bad.url), THASH)).ok, false);
  const none = req('/');
  assert.equal((await previewGate(none, new URL(none.url), THASH)).ok, false);
  const wrongLink = req('/?preview=wrong-key-wrong-key-wrong');
  const g = await previewGate(wrongLink, new URL(wrongLink.url), THASH);
  assert.equal(g.ok, false);
  assert.equal(g.redirect, null);
});

test('?preview=off で印を消す', async () => {
  const r = req('/?preview=off', 'ck_preview=' + TKEY);
  const g = await previewGate(r, new URL(r.url), THASH);
  assert.match(g.redirect.headers.get('Set-Cookie'), /Max-Age=0/);
});

test('本物の入口でも、違う合言葉ではお客様と同じ休止中の画面のまま', { skip: !MAINTENANCE }, async () => {
  assert.equal((await get('/?preview=wrong-key-wrong-key-wrong')).status, 503);
  const res = await worker.fetch(new Request('https://shohizei-check.com/', { headers: { Cookie: 'ck_preview=wrong-key-wrong-key-wrong' } }), env, ctx);
  assert.equal(res.status, 503);
});

test('運営者が見ているページは検索に載せない', () => {
  const res = markPreview(new Response('<html><body>x</body></html>', { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.match(res.headers.get('Cache-Control'), /no-store/);
});
