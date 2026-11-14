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
    out.push(['ご提出いただく届出', '期限', '適用する課税期間', '変更前', '変更後', '特例']);
    if (!r.best.filings.length) out.push(['届出は不要です']);
    r.best.filings.forEach(function (f) {
      if (f.byCase) { // 免税に戻る届出は、課税事業者になった理由で違う
        out.push([f.form + '（届出で課税事業者を選んでいる場合）', f.late ? f.deadline + '（期限切れ・この期間からは戻れません）' : f.deadline, per(r.periods[f.index]), LABEL[f.from], LABEL[f.to], '']);
        out.push([f.alt.form + '（売上が1,000万円を超えて課税事業者になった場合）', f.alt.when, per(r.periods[f.index]), LABEL[f.from], LABEL[f.to], '']);
        return;
      }
      out.push([f.form, f.deadline, per(r.periods[f.index]), LABEL[f.from], LABEL[f.to], f.special ? '飲食料品特例（参考事項の欄に記入）' : '']);
    });
    out.push([]);
    out.push(['前提：売上と仕入れは毎年同じとし、1%の月と8%の月を月数で按分しております。結果は目安でございます。届出と申告につきましては、税理士または税務署にご確認ください。']);
    return out;
  }
  function csv(r, today) { return K.toCsv(rows(r, today)); }
  return { rows: rows, csv: csv };
});
