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
    assert.match(html, p.startsWith('/en') ? /temporarily closed/ : /公開を休止しております/);
    if (!p.startsWith('/en')) assert.match(html, /消費税1%チェッカー/);
    assert.match(html, /contact@shohizei-check.com/);
    assert.match(html, p.startsWith('/en') ? /Checker Henshushitsu/ : /チェッカー編集室/);
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

test('休止中の画面に、何のサイトかの一文・案内の更新日・押せる問い合わせ先がある', { skip: !MAINTENANCE }, async () => {
  const html = await (await get('/')).text();
  assert.match(html, /class="what"/);
  assert.match(html, /この案内の更新日/);
  assert.match(html, /<a class="contact" href="mailto:/);
  const en = await (await get('/en/')).text();
  assert.match(en, /lang="en"/);
  assert.match(en, /Notice updated/);
});
