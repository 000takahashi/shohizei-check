// 食料品8%の年の比べ方と、次の課税期間のテスト
const test = require("node:test");
const assert = require("node:assert/strict");
const Y = require("../site/yearkit.js");
const S = require("../site/calc.js");

const EX = { eatIn: 36000000, foodSales: 4000000, otherSales: 0, foodBuy: 12000000, otherBuy: 9000000, baseSales: 38000000, foodKubun: 3, eatInKubun: 4, otherKubun: 4 };

test("8%の年: 計算は compute（食料品8%）と同じ。少ない方式と届出を出す", () => {
  const r = Y.normalYear({ ...EX, current: "general" });
  const c = S.compute({ ...EX, foodRate: S.RATE.foodNow });
  assert.equal(r.stayTax, c.general);
  assert.equal(r.bestKey, "simple");
  assert.equal(r.saving, c.general - c.simple);
  assert.equal(r.form, "簡易課税制度選択届出書");
  const same = Y.normalYear({ ...EX, current: "simple" });
  assert.equal(same.shouldSwitch, false);
  assert.equal(same.form, null);
});

test("選べない方式を今としている時は、本則課税として比べる", () => {
  const r = Y.normalYear({ ...EX, current: "exempt" });
  assert.equal(r.currentAllowed, false);
  assert.equal(r.current, "general");
});

test("次の課税期間: 届出の期限は、始まる前の日", () => {
  assert.deepEqual(Y.nextPeriod("individual", 0, "2026-11-12"), { start: "2027-01-01", end: "2027-12-31", deadline: "2026-12-31", cutMonths: 9 });
  assert.deepEqual(Y.nextPeriod("corporate", 3, "2026-11-12"), { start: "2027-04-01", end: "2028-03-31", deadline: "2027-03-31", cutMonths: 12 });
  assert.deepEqual(Y.nextPeriod("corporate", 12, "2026-11-12"), { start: "2027-01-01", end: "2027-12-31", deadline: "2026-12-31", cutMonths: 9 });
  // 1%が終わったあと
  assert.deepEqual(Y.nextPeriod("individual", 0, "2029-06-01"), { start: "2030-01-01", end: "2030-12-31", deadline: "2029-12-31", cutMonths: 0 });
  // 期首の当日は、もう次の期間
  assert.equal(Y.nextPeriod("corporate", 3, "2030-04-01").start, "2031-04-01");
  assert.equal(Y.nextPeriod("corporate", 2, "2027-12-01").end, "2029-02-28");
});
