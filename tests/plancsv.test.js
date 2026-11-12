// 2年間の通しの見通しのCSV（site/plancsv.js）のテスト
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../site/plancsv.js");
const K = require("../site/csvkit.js");

test("見本の結果を、年ごとの表と届出の表にしてCSVにする", async () => {
  const { plan, SAMPLE } = await import("../functions/_lib/plan.mjs");
  const r = plan(SAMPLE, "2026-11-12");
  const text = P.csv(r, "2026-11-12");
  const rows = K.parse(text);
  const head = rows.findIndex((x) => x[0] === "課税期間");
  assert.ok(head > 0);
  // 年ごとの行は期間の数だけあり、合計の行が続く
  assert.equal(rows[head + r.periods.length + 1][0], "合計");
  assert.equal(Number(rows[head + r.periods.length + 1][3]), Math.round(r.best.total));
  const fi = rows.findIndex((x) => x[0] === "ご提出いただく届出");
  assert.ok(fi > head);
  if (r.best.filings.length) assert.equal(rows[fi + 1][1], r.best.filings[0].deadline);
  // 目安である旨を必ず入れる
  assert.ok(text.includes("結果は目安でございます"));
});

test("届出が無い時は「不要」と書く", () => {
  const r = {
    current: "general", saving: 0,
    periods: [{ start: "2027-01-01", end: "2027-12-31", cutMonths: 9 }],
    stay: { taxes: [100], total: 100 },
    best: { path: ["general"], taxes: [100], total: 100, monthly: [100], filings: [] },
  };
  const rows = K.parse(P.csv(r, ""));
  assert.ok(rows.some((x) => x[0] === "届出は不要です"));
});
