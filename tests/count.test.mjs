// 見られた数・使われた数（src/count.mjs）の決まりを固定する
import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPath, refHost, pickEvent, writeCount, count, COUNT_SQL } from '../src/count.mjs';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const req = (path, h = {}, method = 'GET') => new Request('https://example.com' + path, { method, headers: { 'user-agent': UA, ...h } });
const html = (status = 200) => new Response('<p>x</p>', { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (status = 200) => new Response('{}', { status, headers: { 'content-type': 'application/json' } });

test('住所は短く決まった形にする', () => {
  assert.equal(cleanPath('/'), '/');
  assert.equal(cleanPath('/guide/'), '/guide');
  assert.equal(cleanPath('/guide/index.html'), '/guide');
  assert.equal(cleanPath('/Guide/Bag/'), '/guide/bag');
  assert.equal(cleanPath('/a?b'), 'other');
  assert.equal(cleanPath('/%E3%81%82'), 'other');
  assert.equal(cleanPath('/' + 'a'.repeat(200)).length, 80);
});

test('参照元は他のサイト名だけ', () => {
  assert.equal(refHost('https://www.google.com/search?q=x', 'example.com'), 'google.com');
  assert.equal(refHost('https://example.com/guide', 'example.com'), '');
  assert.equal(refHost('', 'example.com'), '');
  assert.equal(refHost('not a url', 'example.com'), '');
});

test('人がページを開いた時だけ view を数える', () => {
  assert.deepEqual(pickEvent(req('/guide/', { referer: 'https://www.bing.com/' }), html(), false), { kind: 'view', k1: '/guide', k2: 'bing.com' });
  assert.equal(pickEvent(req('/'), json(), false), null, 'HTML 以外');
  assert.equal(pickEvent(req('/'), html(404), false), null, '見つからない');
  assert.equal(pickEvent(req('/', { 'user-agent': 'Googlebot/2.1' }), html(), false), null, 'ロボット');
  assert.equal(pickEvent(req('/', { 'user-agent': '' }), html(), false), null, 'ブラウザの名前なし');
  assert.equal(pickEvent(req('/', { dnt: '1' }), html(), false), null, '追跡しないで');
  assert.equal(pickEvent(req('/', { 'sec-gpc': '1' }), html(), false), null, 'GPC');
  assert.equal(pickEvent(req('/', { 'sec-purpose': 'prefetch' }), html(), false), null, '先読み');
  assert.equal(pickEvent(req('/', {}, 'HEAD'), html(), false), null, 'GET 以外');
});

test('窓口は、ロボットでも ok／ng を付けて数える', () => {
  assert.deepEqual(pickEvent(req('/mcp', { 'user-agent': 'python-httpx' }, 'POST'), json(), true), { kind: 'api', k1: '/mcp', k2: 'ok' });
  assert.deepEqual(pickEvent(req('/api/v1/pass/claim/', {}, 'POST'), json(402), true), { kind: 'api', k1: '/api/v1/pass/claim', k2: 'ng' });
  assert.equal(pickEvent(req('/api/v1/calc', {}, 'OPTIONS'), json(), true), null);
});

function fakeDb({ table = true } = {}) {
  const runs = [];
  let hasTable = table;
  return {
    runs,
    prepare(sql) {
      return {
        bind(...a) { return { sql, a }; },
        async run() { runs.push(sql); if (/CREATE TABLE/.test(sql)) hasTable = true; },
      };
    },
    async batch(s) { if (!hasTable) throw new Error('D1_ERROR: no such table: ck_count'); runs.push(...s.map((x) => x.sql)); },
  };
}

test('書く物は日付・サイト・種類・住所・参照元だけ', async () => {
  const db = fakeDb();
  let bound;
  const orig = db.prepare.bind(db);
  db.prepare = (sql) => { const p = orig(sql); return { ...p, bind: (...a) => { if (/INTO ck_count \(/.test(sql)) bound = a; return p.bind(...a); } }; };
  await writeCount(db, 'shohizei', { kind: 'view', k1: '/', k2: 'google.com' }, Date.UTC(2026, 10, 16, 12));
  assert.deepEqual(bound, ['2026-11-16', 'shohizei', 'view', '/', 'google.com', 20000]);
});

test('表が無ければ作ってから書く', async () => {
  const db = fakeDb({ table: false });
  await writeCount(db, 'menzei', { kind: 'api', k1: '/mcp', k2: 'ok' });
  assert.equal(db.runs.filter((s) => /CREATE TABLE/.test(s)).length, COUNT_SQL.length);
  assert.ok(db.runs.some((s) => /INSERT INTO ck_count \(/.test(s)));
});

test('COUNTS が無い・壊れていても、ページには何も起きない', async () => {
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };
  count({}, ctx, 'x', req('/'), html(), false);
  assert.equal(waits.length, 0);
  const broken = { prepare() { throw new Error('boom'); }, batch() { throw new Error('boom'); } };
  count({ COUNTS: broken }, ctx, 'x', req('/'), html(), false);
  await Promise.all(waits);
  count({ COUNTS: fakeDb() }, undefined, 'x', req('/'), html(), false);
});
