// 食料品が8%の年（1%の前と、終わったあと）の申告方式を比べる画面（#year・無料）。
// 計算はこのページの中だけ。どこにも送らない。
(function () {
  'use strict';
  var Y = window.YearKit;
  if (!Y || !document.getElementById('v-year')) return;
  var $ = function (id) { return document.getElementById(id); };
  var LABEL = { general: '本則課税', simple: '簡易課税', exempt: '免税事業者' };
  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (cls) e.className = cls; return e; }
  var man = function (n) {
    var a = Math.abs(n);
    var s = a >= 10000 ? (Math.round(a / 1000) / 10).toLocaleString('ja-JP') + '万円' : Math.round(a).toLocaleString('ja-JP') + '円';
    return (n < 0 ? '−' : '') + s;
  };
  var taxText = function (n) { return n < 0 ? '還付 ' + man(-n) : man(n); };
  var wa = function (iso) { var a = iso.split('-').map(Number); return '令和' + (a[0] - 2018) + '年' + a[1] + '月' + a[2] + '日'; };
  var ym = function (iso) { var a = iso.split('-').map(Number); return a[0] + '年' + a[1] + '月'; };
  function today() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }

  function render() {
    var box = $('yrOut'); box.textContent = '';
    var p = window.ShohizeiInput ? window.ShohizeiInput() : null;
    if (!p) { box.appendChild(el('p', 'お手数ですが、先に「申告方式の試算」で売上と仕入れをご入力ください。「計算例」を押していただくと、例の数字でお試しいただけます。', 'bk-msg')); return; }
    var r = Y.normalYear(p), np = Y.nextPeriod(p.who, p.endMonth, today());

    var v = el('div', null, 'pl-verdict ' + (r.shouldSwitch ? 'warn' : 'good'));
    if (r.shouldSwitch) {
      v.appendChild(el('b', '食料品が8%の年は、' + LABEL[r.bestKey] + 'にすると1年で約' + man(r.saving) + '少なくなります'));
      v.appendChild(el('span', '現在の' + LABEL[r.current] + 'のままですと ' + taxText(r.stayTax) + '、' + LABEL[r.bestKey] + 'の場合は ' + taxText(r.bestTax) + ' です。'));
    } else {
      v.appendChild(el('b', '食料品が8%の年は、現在の' + LABEL[r.current] + 'のままが最も少なくなります'));
      v.appendChild(el('span', '1年の納税は ' + taxText(r.stayTax) + ' です。'));
    }
    box.appendChild(v);
    if (!r.currentAllowed) box.appendChild(el('p', 'お選びいただいた方式は、現在の条件では選択できません。本則課税を現在の方式とみなして比較しております。', 'bk-hint'));

    var wrap = el('div', null, 'tablewrap'), t = el('table'), tb = el('tbody');
    var hr = el('tr'); ['方式', '1年の納税'].forEach(function (h) { hr.appendChild(el('th', h)); });
    var th = el('thead'); th.appendChild(hr); t.appendChild(th);
    r.options.forEach(function (o) {
      var tr = el('tr');
      tr.appendChild(el('td', LABEL[o.key] + (o.key === r.current ? '（今）' : '') + (o.key === r.bestKey ? '　最も少ない' : '')));
      var td = el('td', o.allowed ? taxText(o.tax) : '選択できません'); td.className = 'num r'; tr.appendChild(td);
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); box.appendChild(wrap);

    box.appendChild(el('h3', '申告方式を変更する場合の届出'));
    if (!r.shouldSwitch) box.appendChild(el('p', '現在の方式のままであれば、届出は不要です。'));
    else if (r.bestKey === 'exempt') {
      // 免税に戻る届出は、課税事業者になった理由で違う（国税庁 タックスアンサー No.6629）
      box.appendChild(el('p', '免税事業者に戻る場合の届出は、課税事業者になった理由によって異なります。'));
      var ul = el('ul');
      ul.appendChild(el('li', '「課税事業者選択届出書」を出して課税事業者になっている場合：' + r.form + 'を、戻りたい課税期間が始まる前日までにご提出ください。次の課税期間（' + ym(np.start) + '〜' + ym(np.end) + '）から戻る場合、期限は' + wa(np.deadline) + 'です。選んだ期間の初日から2年（一定の場合は3年）を経過する日の属する課税期間が始まるまでは、この届出を出せません。'));
      ul.appendChild(el('li', '売上が1,000万円を超えていたために課税事業者になっている場合：その期間の基準期間の課税売上高が1,000万円以下になり、特定期間の判定でも免税の要件を満たせば（売上に代えて給与等の支払額で判定することもできます）、届出をしなくても免税事業者になります。「消費税の納税義務者でなくなった旨の届出書」を速やかにご提出ください。'));
      box.appendChild(ul);
      box.appendChild(el('p', 'インボイスの登録を受けている場合は、登録の取消しを求める届出書を、取り消したい課税期間の初日から起算して15日前の日までにご提出いただく必要がございます。', 'bk-hint'));
    } else {
      var cut = np.cutMonths > 0;
      box.appendChild(el('p', (r.form ? r.form + 'を、' : '届出を、') + '変更したい課税期間が始まる前日までにご提出ください。'
        + '次の課税期間（' + ym(np.start) + '〜' + ym(np.end) + '）から変更される場合、期限は' + wa(np.deadline) + 'です。'
        + (r.bestKey === 'simple' ? '簡易課税は、選択すると2年間は継続していただく必要がございます。' : '')
        + (r.current === 'exempt' ? '課税事業者を選択すると、2年間は継続していただく必要がございます。' : '')));
      if (cut) {
        var w = el('p', null, 'pl-warn');
        w.appendChild(document.createTextNode('次の課税期間は、食料品が1%になる月を' + np.cutMonths + 'か月含みます。この画面は8%の年の比較のため、次の期間につきましては '));
        var a = el('a', '申告方式の試算'); a.href = '#calc'; w.appendChild(a);
        w.appendChild(document.createTextNode(' と '));
        var b = el('a', '2年間の通しの見通し'); b.href = '#plan'; w.appendChild(b);
        w.appendChild(document.createTextNode(' でお確かめください。'));
        box.appendChild(w);
      } else if (r.form && window.IcsKit) {
        var act = el('div', null, 'bk-actions'), cb = el('button', '期限をカレンダーに登録する', 'bk-btn'); cb.type = 'button';
        cb.addEventListener('click', function () {
          var ics = window.IcsKit.build([{ date: np.deadline, title: '【届出の期限】' + r.form, note: ym(np.start) + '〜' + ym(np.end) + ' の期間から、' + LABEL[r.current] + 'を' + LABEL[r.bestKey] + 'に変更する届出です。税務署へご提出ください。消費税1%チェッカーによる試算（目安）です。ご提出の前に、税理士または税務署にご確認ください。 https://shohizei-check.com/' }], new Date().toISOString().replace(/[-:]|\.\d+/g, ''));
          var l = el('a'); l.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); l.download = 'shohizei-check-kigen.ics';
          document.body.appendChild(l); l.click(); l.remove();
        });
        act.appendChild(cb); box.appendChild(act);
      }
    }
    box.appendChild(el('p', '結果は目安でございます。国と地方を合わせた税率で計算しており、端数処理・75%ルール・インボイスの2割特例や3割特例は含めておりません。届出と申告につきましては、税理士または税務署にご確認ください。', 'bk-hint'));
  }

  // この画面を開いた時と、入力が変わった時に作り直す
  function maybe() { if (!$('v-year').hidden) render(); }
  window.addEventListener('hashchange', maybe);
  window.addEventListener('popstate', maybe);
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('a[href="#year"]')) setTimeout(render, 0); });
  maybe();
})();
