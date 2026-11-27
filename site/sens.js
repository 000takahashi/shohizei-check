/*
 * 動かして確かめる（消費税1%チェッカー）
 * - 売上と仕入れの欄に、つまみを足す（打った数字に合わせて、つまみの幅が広がる）。
 * - 「持ち帰りの割合」「10%の経費」が動くと、方式ごとの納税（この期間）がどう変わるかの線グラフ。
 *   なぞる・矢印キーで、その点の数字が出る。
 * - 業種のボタンは、もう一度押すと、押す前の業種と区分に戻る。押した状態がいつも見える。
 * - 結果を文章でコピーする。すべてクリアの前に、画面の中で確かめる。
 * 計算は calc.js（Shokuhin.compare）だけを使う。数字を作り変えない。入力はどこにも送らない。
 */
(function (root) {
  'use strict';

  // ---- 計算だけ（画面に依存しない・テストで固定） ----
  function num(x) { var v = Number(x); return isFinite(v) && v > 0 ? v : 0; }
  function niceCeil(x) {
    if (!(x > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(x)));
    var ms = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < ms.length; i++) if (ms[i] * p >= x) return ms[i] * p;
    return 10 * p;
  }
  var KINDS = { take: '持ち帰りの割合', buy: '10%の仕入れ・経費' };

  // 持ち帰りの割合（食料品の販売 ÷（店内＋食料品の販売））。店内も食料品も0なら、このグラフは出さない
  function takeShare(a) { var t = num(a.eatIn) + num(a.foodSales); return t > 0 ? num(a.foodSales) / t * 100 : null; }

  function withValue(kind, a, x) {
    var o = {}; for (var k in a) o[k] = a[k];
    if (kind === 'take') { var t = num(a.eatIn) + num(a.foodSales); o.foodSales = t * x / 100; o.eatIn = t - o.foodSales; }
    else o.otherBuy = x;
    return o;
  }
  function range(kind, a) {
    if (kind === 'take') return [0, 100];
    return [0, niceCeil(Math.max(num(a.otherBuy) * 2, (num(a.eatIn) + num(a.foodSales) + num(a.otherSales)) * 0.6, 1000000))];
  }

  // 方式ごとの線（選べる方式だけ）。いちばん少ない方式が入れかわる所も返す
  function series(S, a, kind, n) {
    n = n || 41;
    var rg = range(kind, a), xs = [], lines = {}, best = [], swaps = [];
    for (var i = 0; i < n; i++) {
      var x = rg[0] + (rg[1] - rg[0]) * i / (n - 1);
      var c = S.compare(withValue(kind, a, x));
      xs.push(x);
      c.options.forEach(function (o) { if (!o.allowed) return; (lines[o.key] = lines[o.key] || []).push(o.tax); });
      best.push(c.bestKey);
      if (i > 0 && best[i] !== best[i - 1]) swaps.push({ x: (xs[i - 1] + x) / 2, from: best[i - 1], to: best[i] });
    }
    var x0 = kind === 'take' ? takeShare(a) : num(a.otherBuy);
    return { kind: kind, xs: xs, lines: lines, best: best, swaps: swaps, min: rg[0], max: rg[1], x0: x0 };
  }

  var api = { KINDS: KINDS, takeShare: takeShare, withValue: withValue, range: range, series: series };
  if (typeof module === 'object' && module.exports) { module.exports = api; return; }
  root.ShohizeiSens = api;

  // ---- ここから画面 ----
  var doc = root.document;
  if (!doc) return;
  var $ = function (id) { return doc.getElementById(id); };
  var S = root.Shokuhin;
  if (!S || !$('form') || !$('sheet')) return;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var LABEL = { general: '本則課税', simple: '簡易課税', exempt: '免税事業者' };
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sv(tag, attrs) { var e = doc.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function yen(v) { return (v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('ja-JP') + '円'; }
  function man(v) {
    var a = Math.abs(v), s = v < 0 ? '−' : '';
    if (a >= 10000) return s + (Math.round(a / 1000) / 10).toLocaleString('ja-JP') + '万円';
    return s + Math.round(a).toLocaleString('ja-JP') + '円';
  }
  function fire(input, type) { input.dispatchEvent(new Event(type || 'input', { bubbles: true })); }

  // ---- つまみ（金額の欄。打った数字に合わせて幅を広げる） ----
  var SLIDERS = ['eatIn', 'foodSales', 'otherSales', 'foodBuy', 'otherBuy'];
  var sliders = [];
  SLIDERS.forEach(function (id) {
    var input = $(id); if (!input) return;
    var wrap = input.closest('.input-wrap'); if (!wrap) return;
    var box = el('div', 'ck-range no-print');
    var rng = doc.createElement('input');
    rng.type = 'range'; rng.min = 0; rng.id = id + 'Range';
    var lab = doc.querySelector('label[for="' + id + '"]');
    rng.setAttribute('aria-label', (lab ? lab.textContent : id) + '（つまみ）');
    box.appendChild(rng);
    wrap.parentNode.insertBefore(box, wrap.nextSibling);
    rng.addEventListener('input', function () { input.value = rng.value; fire(input); });
    sliders.push({ input: input, rng: rng });
  });
  function syncSliders() {
    var act = doc.querySelector('[data-per].active');
    var per = root.ShohizeiLast ? root.ShohizeiLast.per : act ? act.dataset.per : 'year';
    var base = per === 'month' ? 5000000 : 60000000; // 1か月なら500万円、1年なら6,000万円までを最初の幅に
    sliders.forEach(function (o) {
      var v = Number(o.input.value || 0); if (!isFinite(v) || v < 0) v = 0;
      if (doc.activeElement !== o.rng) {
        var mx = Math.max(base, niceCeil(v * 1.5));
        o.rng.max = String(mx);
        o.rng.step = String(mx / 600 >= 10000 ? 10000 : mx / 600 >= 1000 ? 1000 : 100);
        o.rng.value = String(Math.min(mx, v));
      }
      o.rng.style.setProperty('--p', Number(o.rng.value) / Number(o.rng.max) * 100 + '%');
    });
  }

  // ---- グラフ（方式ごとの棒の下） ----
  var box = el('section', 'ck-sens');
  box.setAttribute('aria-labelledby', 'ckSensTitle');
  box.hidden = true;
  var head = el('div', 'ck-sens-head');
  var title = el('h3', null, '動くと、方式ごとの納税はどう変わるか'); title.id = 'ckSensTitle';
  var tabs = el('div', 'ck-seg no-print'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '動かすもの');
  var kind = 'take', tabBtns = {};
  [['take', '持ち帰りの割合'], ['buy', '10%の経費']].forEach(function (t) {
    var b = el('button', null, t[1]); b.type = 'button'; b.setAttribute('aria-pressed', t[0] === kind ? 'true' : 'false');
    b.addEventListener('click', function () { kind = t[0]; hover = null; for (var k in tabBtns) tabBtns[k].setAttribute('aria-pressed', k === kind ? 'true' : 'false'); draw(); });
    tabBtns[t[0]] = b; tabs.appendChild(b);
  });
  head.appendChild(title); head.appendChild(tabs);
  var legend = el('p', 'ck-legend');
  var read = el('p', 'ck-sens-read'); read.setAttribute('aria-live', 'polite');
  var svg = sv('svg', { viewBox: '0 0 640 210', role: 'img', tabindex: '0', class: 'ck-sens-svg' });
  var note = el('p', 'ck-sens-note');
  box.appendChild(head); box.appendChild(legend); box.appendChild(read); box.appendChild(svg); box.appendChild(note);
  var anchor = doc.querySelector('.cost-bar-wrap');
  anchor.parentNode.insertBefore(box, anchor.nextSibling);

  var CLS = { general: 'ck-l1', simple: 'ck-l2', exempt: 'ck-l3' };
  var W = 640, H = 210, L = 70, R = 14, T = 14, B = 30;
  var last = null, cur = null, hover = null;
  function nice(raw) { var p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9)))); var ms = [1, 2, 2.5, 5, 10]; for (var i = 0; i < ms.length; i++) if (ms[i] * p >= raw) return ms[i] * p; return 10 * p; }
  function xLabel(x) { return kind === 'take' ? Math.round(x) + '%' : man(x); }
  function xLong(x) { return kind === 'take' ? '持ち帰り ' + Math.round(x) + '%' : '10%の経費 ' + yen(x); }

  function draw() {
    if (!last) return;
    var a = last.args;
    var hasTake = takeShare(a) !== null;
    tabBtns.take.hidden = !hasTake;
    if (kind === 'take' && !hasTake) { kind = 'buy'; for (var k0 in tabBtns) tabBtns[k0].setAttribute('aria-pressed', k0 === kind ? 'true' : 'false'); }
    W = Math.max(300, Math.round(svg.getBoundingClientRect().width || box.getBoundingClientRect().width || 640));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    cur = series(S, a, kind, 41);
    var xs = cur.xs, ids = Object.keys(cur.lines), all = [];
    ids.forEach(function (id) { all = all.concat(cur.lines[id]); });
    var lo = Math.min(0, Math.min.apply(null, all)), hi = Math.max(0, Math.max.apply(null, all));
    if (hi === lo) hi = lo + 1;
    var step = nice((hi - lo) / 4); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var X = function (x) { return L + (W - L - R) * (x - cur.min) / (cur.max - cur.min || 1); };
    var Y = function (y) { return T + (H - T - B) * (1 - (y - lo) / (hi - lo)); };
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    for (var t = lo; t <= hi + 1e-9; t += step) {
      svg.appendChild(sv('line', { x1: L, x2: W - R, y1: Y(t), y2: Y(t), class: 'ck-grid' }));
      var tx = sv('text', { x: L - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'ck-tick' }); tx.textContent = man(t); svg.appendChild(tx);
    }
    if (lo < 0) svg.appendChild(sv('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), class: 'ck-zero ck-zero-soft' }));
    var nx = W < 480 ? 2 : 4;
    for (var j = 0; j <= nx; j++) {
      var xv = cur.min + (cur.max - cur.min) * j / nx;
      var xt = sv('text', { x: X(xv), y: H - 10, 'text-anchor': j === 0 ? 'start' : j === nx ? 'end' : 'middle', class: 'ck-tick' }); xt.textContent = xLabel(xv); svg.appendChild(xt);
    }
    cur.swaps.slice(0, 2).forEach(function (sw) {
      svg.appendChild(sv('line', { x1: X(sw.x), x2: X(sw.x), y1: T, y2: H - B, class: 'ck-cross ck-cross-soft' }));
      var right = X(sw.x) > W - 120;
      var ct = sv('text', { x: X(sw.x) + (right ? -6 : 6), y: T + 12, 'text-anchor': right ? 'end' : 'start', class: 'ck-cross-lab ck-cross-soft' });
      ct.textContent = '入れかわり ' + xLabel(sw.x); svg.appendChild(ct);
    });
    ids.forEach(function (id) {
      var ys = cur.lines[id], d = '';
      for (var i = 0; i < xs.length; i++) d += (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(ys[i]).toFixed(1);
      svg.appendChild(sv('path', { d: d, class: 'ck-line ' + CLS[id] }));
    });
    if (cur.x0 !== null && cur.x0 >= cur.min && cur.x0 <= cur.max) svg.appendChild(sv('line', { x1: X(cur.x0), x2: X(cur.x0), y1: T, y2: H - B, class: 'ck-nowline' }));
    if (hover !== null) {
      svg.appendChild(sv('line', { x1: X(xs[hover]), x2: X(xs[hover]), y1: T, y2: H - B, class: 'ck-hover' }));
      ids.forEach(function (id) { svg.appendChild(sv('circle', { cx: X(xs[hover]), cy: Y(cur.lines[id][hover]), r: 4, class: 'ck-hover-dot ' + CLS[id] })); });
    }
    legend.innerHTML = '';
    ids.forEach(function (id) { legend.appendChild(el('span', 'ck-key ' + CLS[id], LABEL[id])); });
    svg.setAttribute('aria-label', KINDS[kind] + 'を動かした時の、方式ごとの納税の線。左右の矢印キーで点を動かせます');

    // 読み取り（なぞった点、なぞっていない時はいまの入力）
    read.innerHTML = '';
    var hx = hover === null ? cur.x0 : xs[hover];
    var c = S.compare(withValue(kind, a, hx));
    read.appendChild(doc.createTextNode((hover === null ? 'いまの入力：' : '') + xLong(hx) + ' のとき、'));
    c.options.filter(function (o) { return o.allowed; }).forEach(function (o, i) {
      read.appendChild(doc.createTextNode((i ? '・' : '') + LABEL[o.key] + ' '));
      read.appendChild(el('b', o.key === c.bestKey ? 'pos' : null, yen(o.tax)));
    });
    var parts = [];
    if (cur.swaps.length) parts.push(KINDS[kind] + 'が ' + xLabel(cur.swaps[0].x) + ' あたりで、いちばん少ない方式が' + LABEL[cur.swaps[0].from] + 'から' + LABEL[cur.swaps[0].to] + 'に変わります。');
    else parts.push('この範囲では、いちばん少ないのはずっと' + LABEL[cur.best[0]] + 'です。');
    if (kind === 'take') parts.push('店内と食料品の販売の合計はそのままで、割合だけを動かしています。');
    parts.push('金額は「この期間」（1%は' + last.months + 'か月）の目安です。線の上をなぞると、その点の数字が上に出ます。');
    note.textContent = parts.join('');
  }

  function pick(clientX) {
    if (!cur) return;
    var bx = svg.getBoundingClientRect(); if (!bx.width) return;
    var px = (clientX - bx.left) / bx.width * W;
    hover = Math.max(0, Math.min(cur.xs.length - 1, Math.round((px - L) / (W - L - R) * (cur.xs.length - 1))));
    draw();
  }
  svg.addEventListener('pointermove', function (e) { pick(e.clientX); });
  svg.addEventListener('pointerdown', function (e) { pick(e.clientX); });
  svg.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hover = null; draw(); } });
  svg.addEventListener('blur', function () { hover = null; draw(); });
  svg.addEventListener('keydown', function (e) {
    if (!cur) return;
    var n = cur.xs.length;
    if (e.key === 'ArrowRight') { hover = Math.min(n - 1, hover === null ? 0 : hover + 1); e.preventDefault(); draw(); }
    else if (e.key === 'ArrowLeft') { hover = Math.max(0, hover === null ? n - 1 : hover - 1); e.preventDefault(); draw(); }
    else if (e.key === 'Escape') { hover = null; draw(); }
  });
  function redraw() { if (last && !box.hidden) draw(); }
  root.addEventListener('beforeprint', redraw);
  root.addEventListener('afterprint', redraw);
  var rz = null;
  root.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(redraw, 150); });

  // ---- 業種のボタン：押した状態を見せる・もう一度押すと戻る ----
  var KEYS = ['kind', 'foodKubun', 'eatInKubun', 'otherKubun'];
  var prev = null;
  function syncKind() { doc.querySelectorAll('#kindPresets .preset-btn').forEach(function (b) { var on = b.dataset.kind === $('kind').value; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }); }
  var row = $('kindPresets');
  if (row) {
    row.setAttribute('title', 'もう一度押すと、押す前の業種と区分に戻ります');
    row.addEventListener('click', function (e) {
      var btn = e.target.closest('.preset-btn'); if (!btn) return;
      if (btn.dataset.kind === $('kind').value && prev) {
        e.stopImmediatePropagation(); e.preventDefault();
        var p = prev; prev = null;
        KEYS.forEach(function (k, i) { $(k).value = p[i]; });
        fire($('foodKubun'), 'change'); // 区分を変えた時と同じに計算し直す（業種の change は区分を上書きするので使わない）
        syncKind();
        return;
      }
      if (btn.dataset.kind !== $('kind').value) prev = KEYS.map(function (k) { return $(k).value; });
      setTimeout(syncKind, 0);
    }, true);
    $('form').addEventListener('change', function (e) { if (e.isTrusted && KEYS.indexOf(e.target.id) >= 0) prev = null; });
  }

  // ---- 計算のたびに ----
  doc.addEventListener('shohizei:calc', function () {
    syncSliders(); syncKind();
    var L0 = root.ShohizeiLast;
    copyBtn.disabled = !L0;
    box.hidden = !L0;
    if (!L0) { last = null; return; }
    last = L0; hover = null;
    draw();
  });

  // ---- 結果を文章でコピー ----
  var actions = doc.querySelector('#v-calc .top-actions');
  var copyBtn = el('button', 'action-btn'); copyBtn.type = 'button'; copyBtn.id = 'btnCopyText';
  copyBtn.title = '判定・納税・届出の期限を、メモやチャットに貼れる文章でコピーします';
  copyBtn.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg><span class="lbl">文章でコピー</span>';
  if (actions) actions.appendChild(copyBtn);
  function txt(id) { var e = $(id); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; }
  function resultText() {
    var ex = $('exampleNote') && !$('exampleNote').hidden;
    var lines = ['【消費税1%チェッカーの試算' + (ex ? '・計算例' : '') + '（' + txt('periodChip') + '）】'];
    lines.push('判定：' + txt('verdictTitle'));
    lines.push(txt('kpiBestK') + '：' + txt('sBest') + '（' + txt('sBestSub') + '）');
    lines.push('方式を変えた時の差：' + txt('sSave') + '（' + txt('sSaveSub') + '）');
    doc.querySelectorAll('#optBars .opt-row').forEach(function (r) {
      var n = r.querySelector('.opt-name'), v = r.querySelector('.opt-val');
      if (n && v) lines.push('・' + n.textContent.trim() + '：' + v.textContent.trim());
    });
    lines.push('今の納税（食料品8%・1年）：' + txt('sNow'));
    var td = $('todo');
    if (td && td.textContent.trim()) {
      var f = td.querySelector('b'), d = td.querySelector('.todo-date');
      lines.push('届出：' + (f ? f.textContent.trim() : '') + (d ? '（' + d.textContent.trim() + '）' : '') + (!f && !d ? (td.lastChild ? td.lastChild.textContent.trim() : '') : ''));
    }
    lines.push('目安の計算です。届出と申告は、税理士または税務署にご確認ください。https://shohizei-check.com/');
    return lines.join('\n');
  }
  function flash(msg) { var l = copyBtn.querySelector('.lbl'); l.textContent = msg; setTimeout(function () { l.textContent = '文章でコピー'; }, 2200); }
  copyBtn.addEventListener('click', function () {
    var t = resultText();
    function fallback() {
      var ta = doc.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      doc.body.appendChild(ta); ta.select();
      var ok = false; try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      doc.body.removeChild(ta); flash(ok ? 'コピーしました' : 'コピーできませんでした');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { flash('コピーしました'); }, fallback);
    else fallback();
  });

  // ---- すべてクリアの前に確かめる ----
  var clearBtn = $('btnClearForm');
  if (clearBtn && actions) {
    var ask = el('div', 'ck-confirm no-print'); ask.hidden = true; ask.setAttribute('role', 'alertdialog'); ask.setAttribute('aria-label', '入力を消す確認');
    ask.appendChild(el('span', null, '入れた数字をすべて消します。この端末に保存した入力も消えます。'));
    var yes = el('button', 'ck-confirm-yes', '消す'); yes.type = 'button';
    var no = el('button', 'ck-confirm-no', 'やめる'); no.type = 'button';
    ask.appendChild(yes); ask.appendChild(no);
    actions.parentNode.insertBefore(ask, actions.nextSibling);
    var pass = false;
    clearBtn.addEventListener('click', function (e) {
      if (pass) { pass = false; return; }
      e.stopImmediatePropagation(); e.preventDefault();
      ask.hidden = false; no.focus();
    }, true);
    yes.addEventListener('click', function () { ask.hidden = true; pass = true; clearBtn.click(); });
    no.addEventListener('click', function () { ask.hidden = true; clearBtn.focus(); });
  }

  // 読み込む前に1回目の計算が済んでいるので、ここで一度描く
  doc.dispatchEvent(new Event('shohizei:calc'));
})(typeof self !== 'undefined' ? self : this);
