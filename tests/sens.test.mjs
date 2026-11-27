import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../site/calc.js');
const G = require('../site/sens.js');

// 計算例に近い飲食店（店内3,600万円・持ち帰り400万円）
const A = { eatIn: 36000000, foodSales: 4000000, otherSales: 0, foodBuy: 12000000, otherBuy: 8000000, baseSales: 40000000, current: 'general', foodKubun: 3, eatInKubun: 4, otherKubun: 4, share: 0.75 };

test('線は compare と同じ数字（選べる方式だけ）', () => {
  for (const kind of ['take', 'buy']) {
    const s = G.series(S, A, kind, 21);
    s.xs.forEach((x, i) => {
      const c = S.compare(G.withValue(kind, A, x));
      c.options.filter((o) => o.allowed).forEach((o) => assert.equal(s.lines[o.key][i], o.tax));
      assert.equal(s.best[i], c.bestKey);
    });
    assert.ok(!('exempt' in s.lines), '2年前が1,000万円超なら免税の線は出さない');
  }
});

test('持ち帰りの割合を動かしても、店内と食料品の販売の合計は変わらない', () => {
  const o = G.withValue('take', A, 75);
  assert.equal(o.eatIn + o.foodSales, A.eatIn + A.foodSales);
  assert.equal(o.foodSales, 30000000);
  assert.equal(G.takeShare(A), 10);
  assert.equal(G.takeShare({ eatIn: 0, foodSales: 0 }), null);
});

test('いちばん少ない方式が入れかわる所を返す', () => {
  const s = G.series(S, A, 'take', 41);
  assert.ok(s.swaps.length >= 1);
  const sw = s.swaps[0];
  const before = S.compare(G.withValue('take', A, sw.x - 3)).bestKey;
  const after = S.compare(G.withValue('take', A, sw.x + 3)).bestKey;
  assert.equal(before, sw.from); assert.equal(after, sw.to);
});

test('index.html が sens.css と sens.js を読み、計算のたびに知らせる', () => {
  const h = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.ok(h.includes('<link rel="stylesheet" href="sens.css">'));
  assert.ok(h.includes("new Event('shohizei:calc')"));
  assert.ok(h.indexOf('<script src="sens.js"></script>') > h.indexOf('function render()'));
});
