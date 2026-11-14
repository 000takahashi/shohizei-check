// 有料の2画面: 2年間の通しの見通し（#plan）と、持ち帰り・店内の値付け（#price）。
// 計算はサーバー（/api/v1/plan・/api/v1/pricing）でする。入力も結果もサーバーに保存しない。
// 値付けの表の下書きだけ、この端末（localStorage の shohizei_price_draft）に残す。
(function () {
  'use strict';
  if (!document.getElementById('v-plan')) return;
  var $ = function (id) { return document.getElementById(id); };
  var PASS_KEY = 'shohizei_pass', DRAFT_KEY = 'shohizei_price_draft';
  var LABEL = { general: '本則課税', simple: '簡易課税', exempt: '免税事業者' };

  function el(tag, text, cls) { var e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (cls) e.className = cls; return e; }
  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  var man = function (n) {
    var a = Math.abs(n);
    var s = a >= 10000 ? (Math.round(a / 1000) / 10).toLocaleString('ja-JP') + '万円' : Math.round(a).toLocaleString('ja-JP') + '円';
    return (n < 0 ? '−' : '') + s;
  };
  var yen = function (n) { return Math.round(n).toLocaleString('ja-JP') + '円'; };
  var taxText = function (n) { return n < 0 ? '還付 ' + man(-n) : man(n); };
  var wa = function (iso) { var a = iso.split('-').map(Number); return '令和' + (a[0] - 2018) + '年' + a[1] + '月' + a[2] + '日'; };
  var ym = function (iso) { var a = iso.split('-').map(Number); return a[0] + '年' + a[1] + '月'; };
  function perText(p) { return ym(p.start) + '〜' + ym(p.end); }

  function post(path, body) {
    var h = { 'Content-Type': 'application/json' }, pass = getPass();
    if (pass) h.Authorization = 'Bearer ' + pass;
    return fetch(path, { method: 'POST', headers: h, body: JSON.stringify(body) })
      .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); });
  }
  function msg(id, text, isErr) { $(id).textContent = text || ''; $(id).className = 'bk-msg' + (isErr ? ' err' : ''); }
  function table(head, rows) {
    var wrap = el('div', null, 'tablewrap'), t = el('table'), th = el('thead'), tr = el('tr'), tb = el('tbody');
    head.forEach(function (h) { tr.appendChild(el('th', h)); });
    th.appendChild(tr); t.appendChild(th);
    rows.forEach(function (r) {
      var row = el('tr');
      if (r.cls) row.className = r.cls;
      r.cells.forEach(function (c, i) { var td = el('td', c); if (i > 0 && r.num !== false) td.className = 'num r'; td.setAttribute('data-h', head[i]); row.appendChild(td); });
      tb.appendChild(row);
    });
    t.appendChild(tb); wrap.appendChild(t);
    return wrap;
  }
  function needPass(box, lines) {
    box.textContent = '';
    var d = el('div', null, 'pl-lock');
    lines.forEach(function (t, i) { d.appendChild(el(i === 0 ? 'b' : 'p', t)); });
    var a = el('a', '有料パスのご案内を見る', 'bk-btn primary'); a.href = '#pass';
    var w = el('div', null, 'bk-actions'); w.appendChild(a); d.appendChild(w);
    box.appendChild(d);
    box.hidden = false;
  }

  // 免税に戻る届出は、課税事業者になった理由で違う（国税庁 タックスアンサー No.6629）。両方を並べて、ご自身で選んでもらう
  function exemptCases(f, per, r) {
    var d = el('div');
    d.appendChild(el('b', perText(per) + ' の期間から、' + LABEL[f.from] + 'を免税事業者に変更します'));
    d.appendChild(el('p', '必要な届出は、課税事業者になった理由によって異なります。'));
    var ul = el('ul', null, 'pl-cases');
    var a = el('li');
    a.appendChild(el('b', '「課税事業者選択届出書」を出して課税事業者になっている場合'));
    if (f.late) {
      // 期限を過ぎていて、この期間からは戻れない。その人の場合の道を出す
      var e = r.ifElected;
      a.appendChild(el('p', f.form + 'の期限（' + wa(f.deadline) + '）を過ぎているため、この期間からは免税事業者に戻れません。'
        + (e ? 'この場合の最も少ない道は「' + e.path.map(function (m) { return LABEL[m]; }).join(' → ') + '」で、通算 ' + taxText(e.total) + '（今のままより約' + man(e.saving) + '少ない）です。' + (e.filings.length ? 'ご提出いただく届出は、' + e.filings.map(function (g) { return g.form + '（' + wa(g.deadline) + ' まで）'; }).join('、') + 'です。' : '届出は不要です。') : '')));
    } else {
      a.appendChild(el('p', f.form + 'を、' + wa(f.deadline) + ' までにご提出ください（戻りたい課税期間が始まる前日が期限です）。課税事業者を選んだ期間の初日から2年（一定の場合は3年）を経過する日の属する課税期間が始まるまでは、この届出を出せません。'
        + (r.ifElected ? '選んでから2年を経過していない場合の最も少ない道は「' + r.ifElected.path.map(function (m) { return LABEL[m]; }).join(' → ') + '」（通算 ' + taxText(r.ifElected.total) + '）です。' : '')));
    }
    ul.appendChild(a);
    var b = el('li');
    b.appendChild(el('b', '売上が1,000万円を超えていたために課税事業者になっている場合'));
    b.appendChild(el('p', 'その期間の基準期間の課税売上高が1,000万円以下になり、特定期間の判定でも免税の要件を満たせば（売上に代えて給与等の支払額で判定することもできます）、届出をしなくても免税事業者になります。上の見通しはこの場合の結果です。' + f.alt.form + 'を、' + f.alt.when + 'ご提出ください。'));
    ul.appendChild(b);
    d.appendChild(ul);
    d.appendChild(el('p', 'インボイスの登録を受けている場合は、登録の取消しを求める届出書を、取り消したい課税期間の初日から起算して15日前の日までにご提出いただく必要がございます。どちらに当たるか分からない場合は、税務署にお問い合わせください。', 'bk-hint'));
    return d;
  }

  // ---------- 2年間の通しの見通し ----------
  function renderPlan(r, sample) {
    var box = $('plOut'); box.textContent = ''; box.hidden = false;
    $('plLock').hidden = true;
    if (sample) box.appendChild(el('p', '見本：年商4,000万円ほどの、店内飲食が中心の個人経営の飲食店（現在は本則課税）の結果です。', 'pl-sample'));

    var n = r.periods.length, first = r.periods[0], last = r.periods[n - 1];
    var v = el('div', null, 'pl-verdict ' + (r.shouldSwitch ? 'warn' : 'good'));
    if (r.shouldSwitch) {
      v.appendChild(el('b', '申告方式を見直すと、' + n + '年分の通算で約' + man(r.saving) + '少なくなります'));
      v.appendChild(el('span', '現在の' + LABEL[r.current] + 'のままですと合計 ' + taxText(r.stay.total) + '、見直した場合は合計 ' + taxText(r.best.total) + ' です（' + perText({ start: first.start, end: last.end }) + '）。'));
    } else {
      v.appendChild(el('b', '現在の' + LABEL[r.current] + 'のままが、' + n + '年分の通算でも最も少なくなります'));
      v.appendChild(el('span', '合計 ' + taxText(r.best.total) + ' です（' + perText({ start: first.start, end: last.end }) + '）。届出は不要です。'));
    }
    box.appendChild(v);

    if (r.firstYear && r.firstYear.differs && r.firstYear.loss >= 1) {
      box.appendChild(el('p', '1年目だけで選ぶと' + LABEL[r.firstYear.method] + 'が最も少なく見えますが、通算では約' + man(r.firstYear.loss) + '多くなります。申告方式を変更すると、2年間は継続する決まりがあるためです。', 'pl-warn'));
    }

    // 出す届出と期限
    box.appendChild(el('h3', 'ご提出いただく届出と期限'));
    if (!r.best.filings.length) box.appendChild(el('p', '届出は不要です。'));
    else {
      var ol = el('ol', null, 'pl-steps');
      r.best.filings.forEach(function (f) {
        var li = el('li');
        if (f.byCase) { li.appendChild(exemptCases(f, r.periods[f.index], r)); ol.appendChild(li); return; }
        li.appendChild(el('b', f.form));
        li.appendChild(el('span', wa(f.deadline) + ' まで', 'pl-date'));
        li.appendChild(el('p', perText(r.periods[f.index]) + ' の期間から、' + LABEL[f.from] + 'を' + LABEL[f.to] + 'に変更します。'
          + (f.special ? '特例により、この期間の中にご提出いただければ間に合います。届出書の参考事項の欄には「飲食料品特例」とご記入ください。' : 'この期間が始まる前日が期限です。')
          + (f.to === 'simple' ? '簡易課税は、選択すると2年間は継続していただく必要がございます。' : '')
          + (f.from === 'exempt' ? '課税事業者を選択すると、2年間は継続していただく必要がございます。' : '')));
        ol.appendChild(li);
      });
      box.appendChild(ol);
      // 期限をカレンダーに入れる（ファイルはこの端末で作る。どこにも送らない）
      if (window.IcsKit && r.best.filings.some(function (f) { return !(f.byCase && f.late); })) {
        var cal = el('div', null, 'bk-actions pl-noprint'), cb = el('button', '期限をカレンダーに登録する', 'bk-btn'); cb.type = 'button';
        cb.addEventListener('click', function () {
          var ev = r.best.filings.map(function (f) {
            if (f.byCase && f.late) return null; // 期限を過ぎた届出は、カレンダーに入れない
            if (f.byCase) return { date: f.deadline, title: '【届出の期限】' + f.form + '（届出で課税事業者を選んでいる場合）', note: perText(r.periods[f.index]) + ' の期間から免税事業者に戻る届出です。売上が1,000万円を超えて課税事業者になった方は、この届出は不要で、' + f.alt.form + 'を' + f.alt.when + 'ご提出ください。消費税1%チェッカーによる試算（目安）です。ご提出の前に、税理士または税務署にご確認ください。 https://shohizei-check.com/' };
            return { date: f.deadline, title: '【届出の期限】' + f.form, note: perText(r.periods[f.index]) + ' の期間から、' + LABEL[f.from] + 'を' + LABEL[f.to] + 'に変更する届出です。税務署へご提出ください。' + (f.special ? '参考事項の欄には「飲食料品特例」とご記入ください。' : '') + '消費税1%チェッカーによる試算（目安）です。ご提出の前に、税理士または税務署にご確認ください。 https://shohizei-check.com/' };
          }).filter(Boolean);
          var a = el('a'); a.href = URL.createObjectURL(new Blob([window.IcsKit.build(ev, new Date().toISOString().replace(/[-:]|\.\d+/g, ''))], { type: 'text/calendar' })); a.download = 'shohizei-check-kigen.ics';
          document.body.appendChild(a); a.click(); a.remove();
        });
        cal.appendChild(cb); box.appendChild(cal);
        box.appendChild(el('p', '期限の14日前と3日前に、カレンダーからお知らせが届きます。iPhone・Google カレンダー・Outlook でお使いいただけます。', 'bk-hint pl-noprint'));
      }
    }

    // 年ごとの見込み
    box.appendChild(el('h3', '年ごとの納税の見込み'));
    var rows = r.periods.map(function (p, i) {
      return { cells: [perText(p), p.cutMonths + 'か月', LABEL[r.best.path[i]], taxText(r.best.taxes[i]), taxText(r.stay.taxes[i]), r.best.monthly[i] > 0 ? yen(r.best.monthly[i]) : '—'] };
    });
    rows.push({ cls: 'pl-total', cells: ['合計', '', '', taxText(r.best.total), taxText(r.stay.total), ''] });
    box.appendChild(table(['課税期間', '1%の月', '方式', '納税', '今のまま', '毎月の取り置き'], rows));
    box.appendChild(el('p', '毎月の取り置きは、その年の納税額を12で割り、100円単位に切り上げた金額です。申告の際に慌てずに済むよう、目安としてお役立てください。', 'bk-hint'));

    // 方式を変えない場合の比べ
    box.appendChild(el('h3', 'ずっと同じ方式にした場合の合計'));
    box.appendChild(table(['方式', '合計'], r.constant.map(function (c) {
      return { cells: [LABEL[c.key] + (c.key === r.current ? '（今）' : ''), taxText(c.total) + (c.reachable ? '' : '（届出の期限を過ぎているため、最初の期間からは選択できません）')] };
    })));

    if (r.notes.length) { var ul = el('ul', null, 'pl-notes'); r.notes.forEach(function (t) { ul.appendChild(el('li', t)); }); box.appendChild(ul); }
    box.appendChild(el('p', '前提：売上と仕入れは毎年同じとし、1%の月と8%の月を月数で按分しております。1%が終わる時の届出の特例はまだ公表されていないため、通常の期限で計算しております。高額な設備を購入した場合の3年間の継続義務、インボイスの2割・3割特例、75%ルール、端数処理は含めておりません。結果は目安でございます。届出と申告につきましては、税理士または税務署にご確認ください。', 'bk-hint'));

    var act = el('div', null, 'bk-actions pl-noprint');
    var pb = el('button', '印刷する（税理士の先生へのご相談用）', 'bk-btn'); pb.type = 'button';
    pb.addEventListener('click', function () { window.print(); });
    act.appendChild(pb);
    // 表計算ソフト（Excel・Google スプレッドシート）で開けるCSV。この端末で作り、どこにも送らない
    if (window.PlanCsv) {
      var cb = el('button', 'CSVで保存（Excel・スプレッドシート用）', 'bk-btn'); cb.type = 'button';
      cb.addEventListener('click', function () {
        var d = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        var a = el('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + window.PlanCsv.csv(r, d)], { type: 'text/csv;charset=utf-8' })); a.download = 'shohizei-check-mitoshi.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
      act.appendChild(cb);
    }
    box.appendChild(act);
  }

  function runPlan(sample) {
    var input = sample ? null : (window.ShohizeiInput ? window.ShohizeiInput() : null);
    if (!sample && !input) { msg('plMsg', 'お手数ですが、先に「申告方式の試算」で売上と仕入れをご入力ください。', true); $('plOut').hidden = true; $('plLock').hidden = true; return; }
    msg('plMsg', '計算しております…');
    post('/api/v1/plan', sample ? { sample: true } : input).then(function (r) {
      if (r.status === 200) { msg('plMsg', ''); renderPlan(r.data.result, !!r.data.sample); return; }
      if (r.status === 402) {
        var t = r.data.teaser || {};
        msg('plMsg', ''); $('plOut').hidden = true;
        needPass($('plLock'), [
          t.shouldSwitch ? 'ご入力の数字では、申告方式を見直すと ' + t.periods + '年分の通算で約' + man(t.saving) + '少なくなります' : 'ご入力の数字では、現在の申告方式のままが通算でも最も少なくなります',
          (t.firstYearDiffers ? '1年目だけで選ぶ場合と、通算で選ぶ場合とで、最も少なくなる申告方式が異なります。' : '')
            + 'どの申告方式に、いつ変更すべきか。ご提出いただく届出と期限、年ごとの納税額、毎月の取り置きは、有料パスでご覧いただけます。',
        ]);
        return;
      }
      msg('plMsg', r.data && r.data.error === 'empty' ? 'お手数ですが、先に「申告方式の試算」で売上と仕入れをご入力ください。' : '計算できませんでした。恐れ入りますが、しばらくしてからもう一度お試しください。', true);
    }).catch(function () { msg('plMsg', '通信できませんでした。恐れ入りますが、電波の良い場所でもう一度お試しください。', true); });
  }
  $('plGo').addEventListener('click', function () { runPlan(false); });
  $('plSample').addEventListener('click', function () { runPlan(true); });

  // ---------- 値付け ----------
  var MAX = 200;
  function addRow(it) {
    if ($('prRows').children.length >= MAX) return;
    var tr = el('tr');
    [['name', 'text', '例 日替わり弁当'], ['takeout', 'number', '持ち帰り 864'], ['eatIn', 'number', '店内 880']].forEach(function (c) {
      var td = el('td'), i = el('input');
      // スマホでは表の見出しが隠れるので、欄ごとに見出しを出す（CSS の td[data-h]::before）
      td.setAttribute('data-h', { name: '商品名', takeout: '持ち帰り・税込8%', eatIn: '店内・税込10%' }[c[0]]);
      i.type = c[1]; i.placeholder = c[2]; i.setAttribute('data-k', c[0]); i.setAttribute('aria-label', { name: '商品の名前', takeout: '持ち帰りの今の税込み', eatIn: '店内の今の税込み' }[c[0]]);
      if (c[1] === 'number') { i.min = '0'; i.step = '1'; i.inputMode = 'numeric'; } else i.maxLength = 40;
      if (it && it[c[0]]) i.value = it[c[0]];
      td.appendChild(i); tr.appendChild(td);
    });
    var td = el('td', null, 'act'), b = el('button', '消す', 'mini-btn'); b.type = 'button';
    b.addEventListener('click', function () { tr.remove(); if (!$('prRows').children.length) addRow(); saveDraft(); });
    td.appendChild(b); tr.appendChild(td);
    $('prRows').appendChild(tr);
  }
  function readRows() {
    return Array.prototype.map.call($('prRows').children, function (tr) {
      var o = {};
      tr.querySelectorAll('input').forEach(function (i) { o[i.getAttribute('data-k')] = i.type === 'number' ? Number(i.value) || 0 : i.value.trim(); });
      return o;
    }).filter(function (o) { return o.takeout > 0 || o.eatIn > 0; });
  }
  function setRows(items) { $('prRows').textContent = ''; (items && items.length ? items : [null, null, null]).forEach(addRow); }
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ items: readRows(), share: $('prShare').value })); } catch (e) {} }

  // 「同じにする値段」を何と比べているかを、1つめの商品の数字で書く。
  // 店内は今の店内の値段と、持ち帰りは「減税分を全額還元した値段（本体を変えない時）」と比べる
  function sameNote(rows) {
    var x = rows[0], u = x.same.price, kb = x.keepBase.price, d = function (a, b) { return Math.abs(a - b).toLocaleString('ja-JP') + '円'; };
    var name = x.name ? '「' + x.name + '」' : '1つめの商品';
    var eat = u < x.eatIn ? '店内の現在の' + yen(x.eatIn) + 'より' + d(u, x.eatIn) + '安く' : u > x.eatIn ? '店内の現在の' + yen(x.eatIn) + 'より' + d(u, x.eatIn) + '高く' : '店内の現在の' + yen(x.eatIn) + 'と同じで';
    var take = u > kb ? '減税分を全額還元した持ち帰りの' + yen(kb) + 'より' + d(u, kb) + '高い値段です' : u < kb ? '減税分を全額還元した持ち帰りの' + yen(kb) + 'より' + d(u, kb) + '安い値段です' : '減税分を全額還元した持ち帰りの' + yen(kb) + 'と同じ値段です';
    var now = u < x.takeout ? '（現在の持ち帰り' + yen(x.takeout) + 'よりは' + d(u, x.takeout) + '安くなります）' : u > x.takeout ? '（現在の持ち帰り' + yen(x.takeout) + 'よりは' + d(u, x.takeout) + '高くなります）' : '（現在の持ち帰りと同じです）';
    return '例えば' + name + 'の' + yen(u) + 'は、' + eat + '、' + take + now + '。';
  }

  function renderPrice(r, sample) {
    var box = $('prOut'); box.textContent = ''; box.hidden = false; $('prLock').hidden = true;
    if (sample) box.appendChild(el('p', '見本の4つの商品での結果です。', 'pl-sample'));
    box.appendChild(el('h3', '持ち帰りの値段（8%→1%）'));
    box.appendChild(table(['商品', '今の税込み', '本体を変えない時', 'お客様の得', '税込みを変えない時の手取り増'], r.rows.filter(function (x) { return x.keepBase; }).map(function (x) {
      return { cells: [x.name || '（名前なし）', yen(x.takeout), yen(x.keepBase.price), yen(x.keepBase.customerSaves), '+' + x.keepPrice.gainPerSale.toLocaleString('ja-JP') + '円'] };
    })));
    box.appendChild(el('p', '「本体を変えない時」は、下がった税の分をそのままお客様に還元する価格です。「税込みを変えない時」は、値札を据え置いた場合に、1つ売れるごとに増える手取り（税抜き）です。', 'bk-hint'));
    var both = r.rows.filter(function (x) { return x.same; });
    if (both.length) {
      box.appendChild(el('h3', '店内と持ち帰りを同じ値段にする場合'));
      box.appendChild(table(['商品', '今の差', '1%になった時の差', '同じにする値段', 'きりのよい値段'], both.map(function (x) {
        return { cells: [x.name || '（名前なし）', yen(x.gap.now), yen(x.gap.after), yen(x.same.price), yen(x.same.round10)] };
      })));
      box.appendChild(el('p', '「同じにする値段」は、店内で召し上がるお客様が' + r.eatInShare + '%の場合に、売上の本体の合計が現在と変わらない税込み価格です。' + sameNote(both) + '同じ価格にする場合も、店内と持ち帰りで税率が異なる点をレジに設定してください。', 'bk-hint'));
    }
    box.appendChild(el('p', '価格は1円単位で四捨五入しております。最終的な価格は、お店でお決めください。値札の表示方法（税込みの表示）につきましては、税務署や商工会のご案内もあわせてご確認ください。', 'bk-hint'));
    var act = el('div', null, 'bk-actions pl-noprint');
    var cb = el('button', 'CSVで保存', 'bk-btn'); cb.type = 'button';
    cb.addEventListener('click', function () {
      var q = function (s) { return '"' + String(s).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"'; };
      var lines = [['商品', '持ち帰り今', '持ち帰り本体据え置き', 'お客様の得', '税込み据え置きの手取り増', '店内今', '同じにする値段', 'きりのよい値段'].join(',')];
      r.rows.forEach(function (x) {
        lines.push([q(x.name), x.takeout || '', x.keepBase ? x.keepBase.price : '', x.keepBase ? x.keepBase.customerSaves : '', x.keepPrice ? x.keepPrice.gainPerSale : '', x.eatIn || '', x.same ? x.same.price : '', x.same ? x.same.round10 : ''].join(','));
      });
      var a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' })); a.download = 'shohizei-check-nedan.csv';
      document.body.appendChild(a); a.click(); a.remove();
    });
    var pb = el('button', '印刷する', 'bk-btn'); pb.type = 'button'; pb.addEventListener('click', function () { window.print(); });
    act.appendChild(cb); act.appendChild(pb); box.appendChild(act);
  }

  function runPrice(sample) {
    var items = readRows();
    if (!sample && !items.length) { msg('prMsg', '商品の現在の税込み価格を、1つ以上ご入力ください。', true); return; }
    msg('prMsg', '計算しております…');
    post('/api/v1/pricing', sample ? { sample: true } : { items: items, eatInShare: Number($('prShare').value) }).then(function (r) {
      if (r.status === 200) {
        msg('prMsg', '');
        // 見本の数字は、まだ何も入れていない時だけ欄に入れる（入れた値段を消さない）
        if (r.data.sample && !items.length) { setRows(r.data.input.items); $('prShare').value = r.data.input.eatInShare; saveDraft(); }
        renderPrice(r.data.result, !!r.data.sample); return;
      }
      if (r.status === 402) {
        var t = r.data.teaser || {};
        msg('prMsg', ''); $('prOut').hidden = true;
        needPass($('prLock'), [t.items + 'つの商品の値付けの案をご用意できます', '1%になった時の値段、お客様の得、手取りの増え方' + (t.withBoth ? '、店内と持ち帰りを同じにする値段' : '') + 'は、有料パスでご覧いただけます。「見本で見る」から、結果の形式をお確かめいただけます。']);
        return;
      }
      msg('prMsg', r.data && r.data.error === 'too_many' ? '商品は200品目までご入力いただけます。' : '計算できませんでした。恐れ入りますが、ご入力内容をご確認のうえ、もう一度お試しください。', true);
    }).catch(function () { msg('prMsg', '通信できませんでした。恐れ入りますが、電波の良い場所でもう一度お試しください。', true); });
  }

  var draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) {}
  setRows(draft && draft.items);
  if (draft && draft.share !== undefined && draft.share !== '') $('prShare').value = draft.share;
  $('prRows').addEventListener('input', saveDraft);
  $('prShare').addEventListener('input', saveDraft);
  $('prAdd').addEventListener('click', function () { addRow(); });
  $('prGo').addEventListener('click', function () { runPrice(false); });
  $('prSample').addEventListener('click', function () { runPrice(true); });
  $('prClear').addEventListener('click', function () { setRows(null); $('prOut').hidden = true; $('prLock').hidden = true; msg('prMsg', ''); saveDraft(); });
  // 表計算からの貼り付け: 「名前 [タブ] 持ち帰り [タブ] 店内」の行をまとめて入れる
  $('prRows').addEventListener('paste', function (e) {
    var text = (e.clipboardData || window.clipboardData).getData('text') || '';
    if (text.indexOf('\n') === -1 && text.indexOf('\t') === -1) return;
    e.preventDefault();
    var items = text.split(/\r?\n/).map(function (l) { var c = l.split(/\t|,/); return { name: (c[0] || '').trim().slice(0, 40), takeout: Number(String(c[1] || '').replace(/[^\d.]/g, '')) || 0, eatIn: Number(String(c[2] || '').replace(/[^\d.]/g, '')) || 0 }; })
      .filter(function (o) { return o.takeout > 0 || o.eatIn > 0; }).slice(0, MAX);
    if (items.length) { setRows(readRows().concat(items).slice(0, MAX)); saveDraft(); }
  });
})();
