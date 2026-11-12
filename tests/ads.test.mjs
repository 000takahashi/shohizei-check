// 広告枠（site/adsui.js）。3つのチェッカーで同じテスト（直す時は3つそろえる）。
// 守ること: 有料パスが使える間は広告を読み込まない／ページに広告のスクリプトを直接書かない（パスの人にも読み込まれるため）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../site/adsui.js');
const site = (f) => readFileSync(new URL('../site/' + f, import.meta.url), 'utf8');
const html = site('index.html');
const NOW = Date.UTC(2026, 10, 12);
const tok = (sec) => `v1.${sec}.d30-abc.sig`;

test('パスが使える間は広告を出さない（プレビューも出さない）', () => {
  const live = tok(NOW / 1000 + 3600);
  assert.equal(A.decide({ token: live, client: 'ca-pub-3013755960099768', now: NOW }), 'off');
  assert.equal(A.decide({ token: live, client: 'ca-pub-3013755960099768', now: NOW, preview: true }), 'off');
});

test('パスが無い・期限切れ・形が違う時は広告を出す', () => {
  const c = 'ca-pub-3013755960099768';
  assert.equal(A.decide({ token: '', client: c, now: NOW }), 'ads');
  assert.equal(A.decide({ token: tok(NOW / 1000 - 1), client: c, now: NOW }), 'ads');
  assert.equal(A.decide({ token: 'nonsense', client: c, now: NOW }), 'ads');
});

test('パブリッシャーIDが無い・形が違う時は何もしない', () => {
  assert.equal(A.decide({ token: '', client: '', now: NOW }), 'off');
  assert.equal(A.decide({ token: '', client: 'pub-123', now: NOW }), 'off');
  assert.equal(A.decide({ token: '', client: '', now: NOW, preview: true }), 'preview');
});

test('広告ユニットの番号は数字だけ', () => {
  assert.ok(A.validSlot('1234567890'));
  assert.ok(!A.validSlot(''));
  assert.ok(!A.validSlot('12ab'));
});

test('ページに広告のスクリプトを直接書かない（adsui.js が読み込みを決める）', () => {
  assert.doesNotMatch(html, /<script[^>]+adsbygoogle\.js/);
  assert.match(html, /<script src="adsui\.js" data-client="ca-pub-\d+"/);
});

test('パブリッシャーIDが、ページ・確認用の meta・ads.txt でそろっている', () => {
  const id = /data-client="ca-pub-(\d+)"/.exec(html)[1];
  assert.match(html, new RegExp(`<meta name="google-adsense-account" content="ca-pub-${id}">`));
  assert.match(site('ads.txt'), new RegExp(`^google\\.com, pub-${id}, DIRECT, f08c47fec0942fa0`, 'm'));
});

test('広告の枠は data-ad-slot（空か数字）を持つ', () => {
  const slots = [...html.matchAll(/<aside class="adslot"[^>]*>/g)].map((m) => m[0]);
  assert.ok(slots.length >= 1);
  for (const s of slots) assert.match(s, /data-ad-slot="(\d{5,20})?"/);
});

test('有料パスがあるサイトでは、パスを入れている名前が adsui.js の設定と同じ', () => {
  if (!existsSync(new URL('../site/passui.js', import.meta.url))) return;
  const key = /PASS_KEY = '([a-z_]+)'/.exec(site('passui.js'))[1];
  assert.match(html, new RegExp(`data-pass-key="${key}"`));
  assert.match(site('passui.js'), /AdsUI\.hideAll\(\)/);
});

test('CSP がアドセンスの読み込みを許している', () => {
  const h = site('_headers');
  assert.match(h, /script-src[^;]*https:\/\/\*\.googlesyndication\.com/);
  assert.match(h, /frame-src[^;]*https:\/\/\*\.googlesyndication\.com/);
});

test('プライバシーポリシーに広告の Cookie の説明がある', () => {
  assert.match(html, /id="privacy"/);
  assert.match(html, /Google アドセンス/);
  assert.match(html, /adssettings\.google\.com/);
});
