/*
 * 帳簿のCSVから、1年分の売上・仕入れを税率ごとに集める（画面に依存しない）
 * 会計ソフト（freee・マネーフォワード・弥生など）の取引や仕訳の書き出しを想定。
 * ファイルはブラウザの中だけで読み、どこにも送らない。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./csvkit.js'));
  else root.ShokuhinBulk = factory(root.CsvKit);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';

  var SIDES = ['借方', '貸方'];
  var FIELDS = [
    { key: 'date', label: '日付', words: ['取引日', '発生日', '伝票日付', '計上日', '日付', '年月日', 'date'] },
    { key: 'taxCat', label: '税区分', words: ['税区分', '消費税区分', '課税区分', '税率', '消費税'], not: SIDES.concat(['税額', '金額']) },
    { key: 'amount', label: '金額', words: ['税込金額', '金額', '取引金額', '支払金額', 'amount'], not: SIDES.concat(['税額', '本体']) },
    { key: 'tax', label: '税額（金額が税込みの時）', words: ['消費税額', '税額'], not: SIDES },
    { key: 'dir', label: '収入・支出', words: ['収支区分', '収支', '入出金', '取引区分', '区分'], not: SIDES.concat(['税']) },
    { key: 'account', label: '勘定科目', words: ['勘定科目', '科目'], not: SIDES.concat(['補助']) },
    { key: 'debitAccount', label: '借方の勘定科目', words: ['借方勘定科目', '借方科目'] },
    { key: 'debitCat', label: '借方の税区分', words: ['借方税区分', '借方消費税区分', '借方税率'] },
    { key: 'debitAmount', label: '借方の金額', words: ['借方金額', '借方金額(円)'], not: ['税額'] },
    { key: 'creditAccount', label: '貸方の勘定科目', words: ['貸方勘定科目', '貸方科目'] },
    { key: 'creditCat', label: '貸方の税区分', words: ['貸方税区分', '貸方消費税区分', '貸方税率'] },
    { key: 'creditAmount', label: '貸方の金額', words: ['貸方金額', '貸方金額(円)'], not: ['税額'] }
  ];

  function nk(s) { s = String(s || ''); return s.normalize ? s.normalize('NFKC') : s; }

  /*
   * 税区分などの文字から、売上か仕入れか・8%か10%かを読む。
   * 戻り値: { side: 'sale'|'buy'|null, rate: 'r'|'s'|null, skip: 理由|null, back: 返品・値引きか }
   */
  function classify(cat, dir, account) {
    var t = nk(cat), d = nk(dir), a = nk(account);
    if (/非課税|不課税|対象外|免税|輸出|不明|対象外/.test(t)) return { skip: '税のかからない取引（非課税・不課税・免税など）' };
    if (/輸入/.test(t)) return { skip: '輸入の消費税（税関で払う分）' };
    if (/旧|3%|5%/.test(t) && !/10%/.test(t)) return { skip: '古い税率の取引' };
    // 「軽」があれば軽減税率。無ければ 10 を先に見る（「10% 区分80%」を8%と読まない）
    var rate = /軽/.test(t) ? 'r' : (/(^|\D)10(\D|$)/.test(t) ? 's' : (/(^|\D)8(\D|$)/.test(t) ? 'r' : null));
    var side = null;
    if (/売|課売/.test(t)) side = 'sale';
    else if (/仕入|課仕|課対|経費|購入/.test(t)) side = 'buy';
    else if (/収入|入金|売上/.test(d)) side = 'sale';
    else if (/支出|出金|仕入|経費/.test(d)) side = 'buy';
    else if (/売上/.test(a)) side = 'sale';
    if (!t.trim()) return { skip: '税区分が空' };
    if (!rate) return { skip: '税率が読めない' };
    if (!side) return { skip: '売上か仕入れか分からない' };
    return { side: side, rate: rate, skip: null, back: /返還|返品|値引|戻り|割戻/.test(t) };
  }

  // 金額が税込みか税抜きか。税区分に「込」「内税」があれば込み、「抜」「外税」があれば抜き。どちらも無ければ込み
  function guessIncluded(cats) {
    var inc = 0, exc = 0;
    cats.forEach(function (c) { c = nk(c); if (/込|内税/.test(c)) inc++; if (/抜|外税|別/.test(c)) exc++; });
    return exc > inc ? false : true;
  }

  function get(raw, map, key) { return map[key] === undefined ? '' : (raw[map[key]] === undefined ? '' : raw[map[key]]); }
  function has(v) { return typeof v === 'number' && isFinite(v); }
  var RATE = { r: 0.08, s: 0.10 };

  /*
   * opt = { included: true|false|'auto' }
   * 戻り値: { totals: { saleR, saleS, buyR, buyS }（税抜き）, used, skipped: {理由: 件数}, from, to, months, map, ... }
   */
  function run(text, opt, mapOverride) {
    opt = opt || {};
    var t = K.table(text, FIELDS);
    var map = mapOverride || t.map;
    var journal = map.debitCat !== undefined || map.creditCat !== undefined;
    var cats = t.rows.map(function (r) { return journal ? get(r, map, 'debitCat') + ' ' + get(r, map, 'creditCat') : get(r, map, 'taxCat'); });
    var included = opt.included === undefined || opt.included === 'auto' ? guessIncluded(cats) : !!opt.included;

    var totals = { saleR: 0, saleS: 0, buyR: 0, buyS: 0 };
    var counts = { saleR: 0, saleS: 0, buyR: 0, buyS: 0 };
    var skipped = {}, used = 0, from = '', to = '';
    function skip(reason) { skipped[reason] = (skipped[reason] || 0) + 1; }
    function add(c, amount, taxV, sign) {
      if (!has(amount)) { skip('金額が読めない'); return false; }
      var ex = included ? (has(taxV) ? amount - taxV : amount / (1 + RATE[c.rate])) : amount;
      var k = c.side + (c.rate === 'r' ? 'R' : 'S');
      totals[k] += ex * sign;
      counts[k]++;
      return true;
    }

    t.rows.forEach(function (raw) {
      var ok = false;
      if (journal) {
        var dc = classify(get(raw, map, 'debitCat'), '', get(raw, map, 'debitAccount'));
        var cc = classify(get(raw, map, 'creditCat'), '', get(raw, map, 'creditAccount'));
        // 借方の売上は返品・値引き、貸方の仕入れは仕入れの返品
        if (!dc.skip) ok = add(dc, K.num(get(raw, map, 'debitAmount')), NaN, dc.side === 'sale' ? -1 : 1) || ok;
        if (!cc.skip) ok = add(cc, K.num(get(raw, map, 'creditAmount')), NaN, cc.side === 'buy' ? -1 : 1) || ok;
        if (dc.skip && cc.skip) skip(get(raw, map, 'debitCat') || get(raw, map, 'creditCat') ? dc.skip : '税区分が空');
      } else {
        var c = classify(get(raw, map, 'taxCat'), get(raw, map, 'dir'), get(raw, map, 'account'));
        if (c.skip) skip(c.skip);
        else ok = add(c, K.num(get(raw, map, 'amount')), K.num(get(raw, map, 'tax')), c.back ? -1 : 1);
      }
      if (ok) {
        used++;
        var d = K.date(get(raw, map, 'date'));
        if (d) { if (!from || d < from) from = d; if (!to || d > to) to = d; }
      }
    });
    var months = 0;
    if (from && to) months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
    Object.keys(totals).forEach(function (k) { totals[k] = Math.round(totals[k]); });
    return { headers: t.headers, map: map, journal: journal, included: included, totals: totals, counts: counts, used: used, rows: t.rows.length, skipped: skipped, from: from, to: to, months: months, truncated: t.truncated };
  }

  /*
   * 試算の画面に入れる値（1年分・税抜き）。
   * where10 = 'eatIn'（10%の売上を店内飲食に）か 'otherSales'。scale = 12か月に直す倍率
   */
  function toForm(res, where10, scale) {
    var m = scale || 1, t = res.totals;
    var out = { eatIn: 0, foodSales: Math.max(0, Math.round(t.saleR * m)), otherSales: 0, foodBuy: Math.max(0, Math.round(t.buyR * m)), otherBuy: Math.max(0, Math.round(t.buyS * m)) };
    out[where10 === 'otherSales' ? 'otherSales' : 'eatIn'] = Math.max(0, Math.round(t.saleS * m));
    return out;
  }

  var SAMPLE = '日付,収支区分,勘定科目,税区分,金額\r\n' +
    '2026/04/01,収入,売上高,課税売上10%,1100000\r\n' +
    '2026/04/01,収入,売上高,課税売上8%（軽）,216000\r\n' +
    '2026/04/03,支出,仕入高,課対仕入8%（軽）,432000\r\n' +
    '2026/04/05,支出,消耗品費,課対仕入10%,55000\r\n' +
    '2026/04/25,支出,地代家賃,課対仕入10%,220000\r\n' +
    '2026/04/25,支出,給料手当,対象外,600000\r\n' +
    '2026/04/28,支出,租税公課,対象外,30000\r\n';

  var AI_PROMPT = 'これから貼る表（会計ソフトや家計簿・レジから出した明細）を、次の列だけのCSVに変換してください。\n' +
    '列：日付,収支区分,勘定科目,税区分,金額\n' +
    '・1行目は上の列名のまま。1行に1取引。\n' +
    '・日付は 2026/04/01 の形。\n' +
    '・収支区分は「収入」か「支出」。\n' +
    '・税区分は「課税売上10%」「課税売上8%（軽）」「課対仕入10%」「課対仕入8%（軽）」「対象外」のどれか。\n' +
    '　食料品（お酒を除く）の売り買いは8%（軽）、店内での飲食・お酒・家賃などは10%、給料・税金・保険は対象外。\n' +
    '・金額は税込みの円（数字だけ）。\n' +
    '・名前・口座番号などの個人情報は入れないでください。説明の文章は付けず、CSVだけを出してください。';

  return { FIELDS: FIELDS, classify: classify, guessIncluded: guessIncluded, run: run, toForm: toForm, SAMPLE: SAMPLE, AI_PROMPT: AI_PROMPT };
});
