// 帳簿のCSVから売上・仕入れを集める（site/csvkit.js・site/bulk.js）のテスト
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../site/csvkit.js");
const B = require("../site/bulk.js");

test("CSVの分解と文字コード（Shift_JIS も読む）", () => {
  assert.deepEqual(K.parse('a,b\r\n"x, y","1\n2"\r\n'), [["a", "b"], ["x, y", "1\n2"]]);
  const sjis = Uint8Array.from([0x8b, 0xe0, 0x8a, 0x7a]); // 「金額」
  assert.deepEqual(K.decode(sjis), { text: "金額", encoding: "Shift_JIS" });
  assert.equal(K.num("¥1,100"), 1100);
  assert.equal(K.num("△500"), -500);
  assert.equal(K.date("令和8年4月1日"), "2026-04-01");
});

test("税区分の読み方（freee・マネーフォワード・弥生の書き方）", () => {
  assert.deepEqual(B.classify("課税売上8%（軽）"), { side: "sale", rate: "r", skip: null, back: false });
  assert.equal(B.classify("課税売上10%").rate, "s");
  assert.equal(B.classify("課対仕入8%（軽）").side, "buy");
  assert.equal(B.classify("課税仕入 10%").side, "buy");
  assert.equal(B.classify("課対仕入込軽減8%").rate, "r");
  assert.equal(B.classify("課税仕入 10% 区分80%").rate, "s"); // 経過措置の80%を8%と読まない
  assert.equal(B.classify("課税売上返還10%").back, true);
  assert.ok(B.classify("対象外").skip);
  assert.ok(B.classify("非課税売上").skip);
  assert.ok(B.classify("輸出売上").skip);
  assert.ok(B.classify("").skip);
  // 税区分が「10%」だけの時は、収支区分や科目で売上か仕入れかを決める
  assert.equal(B.classify("10%", "収入").side, "sale");
  assert.equal(B.classify("8%", "", "仕入高").skip, "売上か仕入れか分からない");
});

test("1列型（収支区分・税区分・金額）：税込みの金額を税抜きにして税率ごとに集める", () => {
  const r = B.run(B.SAMPLE, {});
  assert.equal(r.included, true);
  assert.deepEqual(r.totals, { saleR: 200000, saleS: 1000000, buyR: 400000, buyS: 250000 });
  assert.equal(r.skipped["税のかからない取引（非課税・不課税・免税など）"], 2);
  assert.equal(r.from, "2026-04-01");
  assert.equal(r.months, 1);
});

test("税額の列があれば、割り算ではなく金額−税額で税抜きにする", () => {
  const r = B.run("日付,税区分,金額,税額\n2026/4/1,課税売上10%,1100,99\n", {});
  assert.equal(r.totals.saleS, 1001);
});

test("税抜きの帳簿・返品はマイナス", () => {
  const r = B.run("税区分,金額\n課税売上10%,1000\n課税売上返還10%,100\n", { included: false });
  assert.equal(r.totals.saleS, 900);
});

test("仕訳型（借方・貸方）：貸方の売上・借方の仕入れを拾い、逆側は返品として引く", () => {
  const csv = "日付,借方勘定科目,借方税区分,借方金額(円),貸方勘定科目,貸方税区分,貸方金額(円)\n" +
    "2026/05/01,現金,対象外,108000,売上高,課税売上 8%(軽),108000\n" +
    "2026/05/02,仕入高,課税仕入 10%,11000,現金,対象外,11000\n" +
    "2026/05/03,売上高,課税売上 8%(軽),1080,現金,対象外,1080\n" +
    "2026/05/04,給料手当,対象外,200000,普通預金,対象外,200000\n";
  const r = B.run(csv, {});
  assert.equal(r.journal, true);
  assert.deepEqual(r.totals, { saleR: 99000, saleS: 0, buyR: 0, buyS: 10000 });
  assert.equal(r.used, 3);
});

test("試算の画面へ：10%の売上の入れ先と、1年分への換算", () => {
  const r = B.run(B.SAMPLE, {});
  assert.deepEqual(B.toForm(r, "eatIn", 12), { eatIn: 12000000, foodSales: 2400000, otherSales: 0, foodBuy: 4800000, otherBuy: 3000000 });
  assert.equal(B.toForm(r, "otherSales").otherSales, 1000000);
});
