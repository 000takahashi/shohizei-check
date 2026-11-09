// node --test tests/  （依存なし）
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../site/calc.js");

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("国税庁パンフ p.6 の簡易課税の計算例（スーパー）は納付10万円", () => {
  const r = S.compute({ foodSales: 20_000_000, otherSales: 3_000_000, eatIn: 1_000_000,
    foodKubun: 2, otherKubun: 2, eatInKubun: 4 });
  close(r.salesTaxTotal, 600_000);
  close(r.deduct, 500_000);
  close(r.simple, 100_000);
});

test("国税庁パンフ p.7 の中間申告の例: 本則で8%なら140万円、1%なら70万円", () => {
  const p = { foodSales: 30_000_000, otherSales: 20_000_000, foodBuy: 20_000_000, otherBuy: 14_000_000 };
  close(S.compute({ ...p, foodRate: 0.08 }).general, 1_400_000);
  close(S.compute(p).general, 700_000);
});

test("店内飲食中心の飲食店は、本則のままだと納税が増える", () => {
  const c = S.compare({ eatIn: 40_000_000, foodBuy: 12_000_000, otherBuy: 10_000_000,
    eatInKubun: 4, foodKubun: 3, baseSales: 40_000_000, current: "general" });
  // 今: 400万 − (96万+100万) = 204万 / 1%: 400万 − (12万+100万) = 288万
  close(c.nowTax, 2_040_000);
  close(c.stayTax, 2_880_000);
  // 簡易: 400万 − 400万×60% = 160万 → 簡易が最少
  assert.equal(c.bestKey, "simple");
  close(c.bestTax, 1_600_000);
  assert.equal(c.shouldSwitch, true);
});

test("食品の卸は本則で還付になり、簡易より有利", () => {
  const c = S.compare({ foodSales: 80_000_000, foodBuy: 70_000_000, otherBuy: 5_000_000,
    foodKubun: 1, otherKubun: 1, baseSales: 80_000_000, current: "general" });
  close(c.cut.general, 800_000 - 700_000 - 500_000); // −40万 = 還付
  assert.equal(c.bestKey, "general");
  assert.equal(c.cut.canSimple, false); // 5千万超は簡易を選べない
});

test("基準期間が1千万円以下なら免税も比べる。還付が出るなら本則が勝つ", () => {
  const r = S.compute({ foodSales: 6_000_000, foodBuy: 3_000_000, otherBuy: 2_000_000, baseSales: 8_000_000 });
  assert.equal(r.canExempt, true);
  assert.equal(r.best.key, "general");
  assert.ok(r.general < 0);
});

test("基準期間を入れない時は免税を候補にしない", () => {
  const r = S.compute({ eatIn: 5_000_000 });
  assert.equal(r.canExempt, false);
  assert.equal(r.canSimple, true);
});

test("マイナスや文字は0として扱う", () => {
  const r = S.compute({ eatIn: -100, foodSales: "abc", otherSales: NaN });
  close(r.salesTaxTotal, 0);
});

test("令和9年4月1日を含む課税期間と届出の期限", () => {
  assert.deepEqual(S.period("individual"), { start: "2027-01-01", end: "2027-12-31", deadline: "2027-12-31" });
  assert.deepEqual(S.period("corporate", 3), { start: "2027-04-01", end: "2028-03-31", deadline: "2028-03-31" });
  assert.deepEqual(S.period("corporate", 12), { start: "2027-01-01", end: "2027-12-31", deadline: "2027-12-31" });
  assert.deepEqual(S.period("corporate", 4), { start: "2026-05-01", end: "2027-04-30", deadline: "2027-04-30" });
  assert.equal(S.period("corporate", 2).end, "2028-02-29");
});

test("届出: 簡易から本則は特例で課税期間の中、本則から簡易は始まる前の日", () => {
  const a = S.steps("simple", "general", "individual");
  assert.equal(a.form, "簡易課税制度選択不適用届出書");
  assert.equal(a.deadline, "2027-12-31");
  const b = S.steps("general", "simple", "corporate", 3);
  assert.equal(b.form, "簡易課税制度選択届出書");
  assert.equal(b.deadline, "2027-03-31");
  assert.equal(S.steps("exempt", "general", "corporate", 12).deadline, "2027-12-31");
  assert.equal(S.steps("general", "general", "individual").need, false);
});

test("インボイス登録や特定期間の超過があると、免税は選べない", () => {
  const base = { eatIn: 5_000_000, foodSales: 1_000_000, foodBuy: 2_000_000, otherBuy: 1_000_000, baseSales: 6_000_000 };
  assert.equal(S.compute(base).canExempt, true);
  assert.equal(S.compute(Object.assign({}, base, { invoice: true })).canExempt, false);
  assert.equal(S.compute(Object.assign({}, base, { specifiedOver: "1" })).canExempt, false);
  assert.notEqual(S.compute(Object.assign({}, base, { invoice: true })).best.key, "exempt");
});

test("令和9年4月1日を含む課税期間の、1%になる月の数", () => {
  const m = (who, e) => { const pr = S.period(who, e); return S.cutMonths(pr.start, pr.end); };
  assert.equal(m("individual"), 9);   // 1〜3月は8%
  assert.equal(m("corporate", 3), 12);
  assert.equal(m("corporate", 4), 1); // 令和8年5月〜令和9年4月は11か月が8%
  assert.equal(S.cutMonths("2028-04-01", "2029-03-31"), 12);
  assert.equal(S.cutMonths("2029-01-01", "2029-12-31"), 3);
});

test("8%と1%が混ざる期間は、月で按分して比べる", () => {
  const p = { eatIn: 30_000_000, foodSales: 10_000_000, foodBuy: 12_000_000, otherBuy: 6_000_000, current: "general" };
  const full = S.compare(p);
  const mix = S.compare(Object.assign({}, p, { share: 0.75 }));
  const g = (r, k) => r.options.find((o) => o.key === k).tax;
  const now = g(full.now, "general"), cut = g(full.cut, "general");
  assert.equal(Math.round(g(mix, "general")), Math.round(0.75 * cut + 0.25 * now));
  assert.equal(Math.round(mix.stayTax), Math.round(0.75 * cut + 0.25 * now));
  assert.equal(full.full.bestKey, full.bestKey);
});

test("飲食料品を売っていないと、届出の特例は使えない", () => {
  const a = S.steps("simple", "general", "individual", undefined, false);
  assert.equal(a.special, false);
  assert.equal(a.deadline, "2026-12-31");
  const b = S.steps("exempt", "general", "corporate", 3, false);
  assert.equal(b.deadline, "2027-03-31");
  assert.equal(S.steps("simple", "general", "individual", undefined, true).deadline, "2027-12-31");
});

test("注意の文は、8%と1%を混ぜた結果から作る", () => {
  const p = { foodSales: 6_000_000, foodBuy: 2_000_000, otherBuy: 800_000, baseSales: 8_000_000, current: "exempt" };
  const full = S.compare(p);
  const mix = S.compare(Object.assign({}, p, { share: 0.75 }));
  const g = mix.options.find((o) => o.key === "general").tax;
  assert.ok(g > 0, "混ぜた本則課税は納付");
  assert.ok(full.cut.general < 0, "丸1年1%なら還付");
  assert.ok(!mix.notes.some((n) => n.includes("還付")), "混ぜた期間で還付と言わない");
  assert.ok(full.notes.some((n) => n.includes("還付")));
});

test("今の方式が条件に合わない時は、本則課税を今として比べる", () => {
  const c = S.compare({ eatIn: 30_000_000, foodSales: 4_000_000, foodBuy: 10_000_000, otherBuy: 8_000_000,
    baseSales: 38_000_000, current: "exempt", foodKubun: 3, eatInKubun: 4, otherKubun: 4 });
  assert.equal(c.currentAllowed, false);
  assert.equal(c.current, "general");
  assert.notEqual(c.bestKey, "exempt");
  assert.ok(c.stayTax > 0);
  assert.ok(c.notes[0].includes("免税事業者になれません"));
  const d = S.compare({ eatIn: 60_000_000, foodBuy: 20_000_000, baseSales: 60_000_000, current: "simple" });
  assert.equal(d.currentAllowed, false);
  assert.equal(d.current, "general");
  assert.equal(d.bestKey, "general");
});
