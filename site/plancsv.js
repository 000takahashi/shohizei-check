/*
 * 2年間の通しの見通し（#plan・有料）の結果を、表計算ソフトで開けるCSVの行にする（画面に依存しない）。
 * サーバーから届いた結果をこの端末で並べ替えるだけ。どこにも送らない。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./csvkit.js'));
  else root.PlanCsv = factory(root.CsvKit);
})(typeof self !== 'undefined' ? self : this, function (K) {
  'use strict';
  var LABEL = { general: '本則課税', simple: '簡易課税', exempt: '免税事業者' };
  function ym(iso) { var a = iso.split('-').map(Number); return a[0] + '年' + a[1] + '月'; }
  function per(p) { return ym(p.start) + '〜' + ym(p.end); }
  function yen(n) { return Math.round(n); }

  /* 戻り値: CsvKit.toCsv に渡せる行の配列 */
  function rows(r, today) {
    var out = [];
    out.push(['消費税1%チェッカー 2年間の通しの見通し（目安）', '作成日 ' + (today || '')]);
    out.push(['現在の方式', LABEL[r.current], '見直した場合の合計（円）', yen(r.best.total), '今のままの合計（円）', yen(r.stay.total), '差（円）', yen(r.saving)]);
    out.push([]);
    out.push(['課税期間', '1%の月数', '方式', '納税（円・マイナスは還付）', '今のまま（円）', '毎月の取り置き（円）']);
    r.periods.forEach(function (p, i) {
      out.push([per(p), p.cutMonths, LABEL[r.best.path[i]], yen(r.best.taxes[i]), yen(r.stay.taxes[i]), r.best.monthly[i] > 0 ? r.best.monthly[i] : 0]);
    });
    out.push(['合計', '', '', yen(r.best.total), yen(r.stay.total), '']);
    out.push([]);
    out.push([r.twoStarts ? 'ご提出いただく届出（課税事業者選択届出書をまだ出していない場合）' : 'ご提出いただく届出', '期限', '適用する課税期間', '変更前', '変更後', '特例']);
    var row = function (f) {
      return [f.form, f.info ? f.when : f.deadline, per(r.periods[f.index]), f.elect ? '免税事業者（課税事業者を選択）' : LABEL[f.from], LABEL[f.to], f.tokurei ? '2割・3割特例の翌年の特例（申告期限まで）' : f.special ? '飲食料品特例（参考事項の欄に記入）' : ''];
    };
    if (!r.best.filings.length) out.push(['届出は不要です']);
    r.best.filings.forEach(function (f) { out.push(row(f)); });
    if (r.ifElected) {
      out.push([]);
      out.push(['すでに課税事業者選択届出書を出していて、2年を過ぎている場合', r.ifElected.same ? '最も少ない道は同じ' : '道 ' + r.ifElected.path.map(function (m) { return LABEL[m]; }).join(' → ') + '・合計 ' + yen(r.ifElected.total)]);
      if (!r.ifElected.filings.length) out.push(['届出は不要です']);
      r.ifElected.filings.forEach(function (f) { out.push(row(f)); });
    }
    out.push([]);
    out.push(['前提：売上と仕入れは毎年同じとし、1%の月と8%の月を月数で按分しています。結果は目安です。届出と申告につきましては、税理士または税務署にご確認ください。']);
    return out;
  }
  function csv(r, today) { return K.toCsv(rows(r, today)); }
  return { rows: rows, csv: csv };
});
