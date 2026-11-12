// 食料品が8%の年（1%の前と、終わったあと）の申告方式を比べる。画面に依存しない。
// 減税と関係なく、毎年の「本則か簡易か」に使える。計算は calc.js の compute をそのまま使う。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'));
  else root.YearKit = factory(root.Shokuhin);
})(typeof self !== 'undefined' ? self : this, function (S) {
  'use strict';
  var FORMS = {
    'general>simple': '簡易課税制度選択届出書',
    'simple>general': '簡易課税制度選択不適用届出書',
    'exempt>general': '課税事業者選択届出書',
    'general>exempt': '課税事業者選択不適用届出書',
    'simple>exempt': '課税事業者選択不適用届出書',
  };
  function iso(d) { return d.toISOString().slice(0, 10); }
  function dayBefore(s) { return iso(new Date(Date.parse(s + 'T00:00:00Z') - 86400000)); }

  /** きょうより後に始まる、次の課税期間。届出はその前の日まで。 */
  function nextPeriod(who, endMonth, today) {
    var y = Number(today.slice(0, 4));
    var sm = who === 'corporate' ? (Math.min(12, Math.max(1, Math.floor(Number(endMonth) || 3))) % 12) + 1 : 1; // 始まる月
    var start = null;
    for (var k = 0; k < 3 && !start; k++) {
      var s = iso(new Date(Date.UTC(y + k, sm - 1, 1)));
      if (s > today) start = s;
    }
    var d = new Date(start + 'T00:00:00Z');
    var end = dayBefore(iso(new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), 1))));
    return { start: start, end: end, deadline: dayBefore(start), cutMonths: S.cutMonths(start, end) };
  }

  /** 食料品8%の1年分で、方式ごとの納税を比べる。p は compute と同じ（current を足す）。 */
  function normalYear(p) {
    var r = S.compute(Object.assign({}, p, { foodRate: S.RATE.foodNow }));
    var pick = function (k) { for (var i = 0; i < r.options.length; i++) if (r.options[i].key === k) return r.options[i]; };
    var input = ['general', 'simple', 'exempt'].indexOf(p.current) >= 0 ? p.current : 'general';
    var current = pick(input).allowed ? input : 'general';
    var stay = pick(current).tax, best = r.best;
    var sw = best.key !== current && stay - best.tax >= 1;
    // 簡易課税は、1年だけ少なくても2年は続ける。免税⇄簡易は届出が2つ要るので、ここでは名前を出さない
    return {
      options: r.options, current: current, currentAllowed: pick(input).allowed,
      stayTax: stay, bestKey: best.key, bestTax: best.tax, saving: sw ? stay - best.tax : 0, shouldSwitch: sw,
      form: sw ? (FORMS[current + '>' + best.key] || null) : null,
    };
  }
  return { nextPeriod: nextPeriod, normalYear: normalYear, FORMS: FORMS };
});
