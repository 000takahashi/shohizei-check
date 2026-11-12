// 有料パスのページ（説明・買う・受け取る）と、特定商取引法に基づく表記。
// パスはこの端末（localStorage の shohizei_pass）にだけ入る。名前・メール・カードは入っていない。
(function () {
  'use strict';
  var S = window.ShopInfo;
  if (!S || !document.getElementById('v-pass')) return;
  var $ = function (id) { return document.getElementById(id); };
  var PASS_KEY = 'shohizei_pass';
  var busy = false;

  function el(tag, text, cls) { var e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  // 印の中の期限（ミリ秒）。形が違えば 0
  function expiryOf(token) { var m = /^v1\.(\d{1,12})\./.exec(token || ''); return m ? Number(m[1]) * 1000 : 0; }
  function dateText(ms) { var d = new Date(ms); return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function msg(text, isErr) { $('psMsg').textContent = text || ''; $('psMsg').className = 'bk-msg' + (isErr ? ' err' : ''); }

  // 無料開放の期間は、「有料」の印を「◯月◯日まで無料」に変え、有料の画面の上に知らせを出す
  if (S.freeOpen()) {
    var until = S.freeText();
    Array.prototype.forEach.call(document.querySelectorAll('.nav-paid'), function (n) { n.textContent = until + 'まで無料'; });
    Array.prototype.forEach.call(document.querySelectorAll('.plan-cta span'), function (n) { n.textContent = n.textContent.replace('（有料）', '（' + until + 'まで無料）'); });
    if ($('homeFree')) { $('homeFree').textContent = until + 'まで、「2年間の通しの見通し」と「持ち帰りの値付け」も無料でお使いいただけます。ご登録もお支払いも不要です。'; $('homeFree').hidden = false; }
    ['v-plan', 'v-price', 'v-pass'].forEach(function (id) {
      var head = document.querySelector('#' + id + ' .page-head-text');
      if (head) head.appendChild(el('p', until + 'まで、この機能を無料で使えます。登録も支払いも要りません。その次の日からは、有料パスが要ります。', 'free-note'));
    });
  }

  S.FEATURES.forEach(function (t) { $('psFeatures').appendChild(el('li', t)); });
  $('psPrice').textContent = S.PLANS.map(S.planText).join(' ／ ');
  // 買うパスを選ぶ（最初は日数の長い方）
  var chosen = S.PLANS[S.PLANS.length - 1].id;
  S.PLANS.forEach(function (p) {
    var label = document.createElement('label'); label.className = 'ps-plan';
    var input = document.createElement('input'); input.type = 'radio'; input.name = 'psPlan'; input.value = p.id; input.checked = p.id === chosen;
    input.addEventListener('change', function () { chosen = p.id; terms(); });
    label.appendChild(input);
    label.appendChild(el('b', p.days + '日間'));
    label.appendChild(el('span', p.yen.toLocaleString('ja-JP') + '円（税込）'));
    $('psPlans').appendChild(label);
  });

  // 支払いの直前に見せる決まり（特定商取引法 第12条の6）
  function terms() {
    var P = S.planById(chosen);
    $('psTerms').textContent = '';
    $('psGo').textContent = P.days + '日間 ' + P.yen.toLocaleString('ja-JP') + '円で買う';
  [
    ['内容', '上の4つの機能が使えます。計算の結果は目安です。法案が成立することが前提です。'],
    ['価格', P.yen.toLocaleString('ja-JP') + '円（税込）。ほかにかかるのは、通信料だけです。'],
    ['期間', 'お支払いの時から' + P.days + '日間。自動で更新されません。' + (S.upgradeFrom(P.id) ? 'パスが使える間は、差額の' + S.upgradeFrom(P.id).yen.toLocaleString('ja-JP') + '円で' + S.upgradeFrom(P.id).to.days + '日間に切り替えられます。' : '')],
    ['支払い', 'クレジットカード・デビットカード。ご購入の時に確定します。'],
    ['使える時期', 'お支払いが済むと、すぐに使えます。'],
    ['キャンセル・返金', 'お支払いの後は、キャンセル・返金できません。当方の不具合で使えなかった場合は、全額を返金します。'],
  ].forEach(function (r) { $('psTerms').appendChild(el('dt', r[0])); $('psTerms').appendChild(el('dd', r[1])); });
  }
  terms();

  var lastSale = null;
  // 短いパスを持っている人に、差額だけで長いパスへ切り替える案内を出す
  function upgradeBox(active, exp) {
    var u = active ? S.upgradeFrom(S.planOfToken(getPass())) : null;
    var show = !!(u && lastSale && lastSale.onSale);
    $('psUp').hidden = !show;
    if (!show) return;
    var yen = u.yen.toLocaleString('ja-JP'), newExp = exp + u.addDays * 86400000;
    $('psUpText').textContent = '差額の' + yen + '円で、' + u.to.days + '日間のパスに切り替えられます。期限は ' + dateText(newExp) + ' までに延びます。';
    $('psUpTerms').textContent = '';
    [
      ['内容', 'いまのパスを、' + u.to.days + '日間のパスに切り替えます。使える機能は同じです。'],
      ['価格', yen + '円（税込）。' + u.to.days + '日間の値段から、' + u.from.days + '日間の値段を引いた額です。'],
      ['期間', '最初のお支払いの時から' + u.to.days + '日間（' + dateText(newExp) + ' まで）。自動で更新されません。'],
      ['支払い', 'クレジットカード・デビットカード。ご購入の時に確定します。'],
      ['使える時期', 'お支払いが済むと、すぐに期限が延びます。'],
      ['キャンセル・返金', 'お支払いの後は、キャンセル・返金できません。当方の不具合で使えなかった場合は、全額を返金します。'],
    ].forEach(function (r) { $('psUpTerms').appendChild(el('dt', r[0])); $('psUpTerms').appendChild(el('dd', r[1])); });
    $('psUpGo').textContent = '差額' + yen + '円で' + u.to.days + '日間に切り替える';
    $('psUpGo').dataset.plan = u.to.id;
  }

  function render(sale) {
    if (sale) lastSale = sale; else sale = lastSale;
    var exp = expiryOf(getPass()), active = exp > Date.now();
    upgradeBox(active, exp);
    $('psHave').hidden = !active;
    if (active) $('psHaveText').textContent = 'パスが使えます。' + dateText(exp) + ' まで有効です。';
    if (!active && exp > 0) msg('前のパスは期限が切れました。');
    $('psBuy').hidden = !(sale && sale.onSale) || active;
    $('psSoon').hidden = !!(sale && sale.onSale) || active;
    if (S.freeOpen()) $('psSoon').textContent = S.freeText() + 'までは、パスなしで全部の機能が使えます。パスは、その次の日から買えます。';
  }

  // 表記のページ。販売者の表示が入るまでは「準備中」
  var rows = S.legalRows();
  $('lgSoon').hidden = rows.length > 0;
  $('lgBody').hidden = !rows.length;
  if (rows.length) {
    $('lgNote').textContent = S.legalNote();
    rows.forEach(function (r) { var tr = document.createElement('tr'); tr.appendChild(el('th', r[0])); tr.appendChild(el('td', r[1])); $('lgRows').appendChild(tr); });
  }

  function post(path, body, pass) {
    var headers = { 'Content-Type': 'application/json' };
    if (pass) headers.Authorization = 'Bearer ' + pass;
    return fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) })
      .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); });
  }

  $('psGo').addEventListener('click', function () {
    if (busy) return;
    busy = true; $('psGo').disabled = true; msg('支払いの画面を開いています…');
    post('/api/v1/pass/checkout', { plan: chosen }).then(function (r) {
      if (r.status === 200 && r.data.url && r.data.url.indexOf('https://checkout.stripe.com/') === 0) { location.href = r.data.url; return; }
      msg(r.status === 503 ? 'まだ売り出していません。' : '支払いの画面を開けませんでした。少し待ってからもう一度お試しください。', true);
      busy = false; $('psGo').disabled = false;
    }).catch(function () { msg('通信できませんでした。電波のよい所でもう一度お試しください。', true); busy = false; $('psGo').disabled = false; });
  });

  $('psUpGo').addEventListener('click', function () {
    if (busy) return;
    busy = true; $('psUpGo').disabled = true; msg('支払いの画面を開いています…');
    var again = function () { busy = false; $('psUpGo').disabled = false; };
    post('/api/v1/pass/checkout', { plan: $('psUpGo').dataset.plan, upgrade: true }, getPass()).then(function (r) {
      if (r.status === 200 && r.data.url && r.data.url.indexOf('https://checkout.stripe.com/') === 0) { location.href = r.data.url; return; }
      msg(r.status === 409 ? 'このパスは切り替えられません。期限が切れている場合は、新しくお求めください。' : r.status === 503 ? 'まだ売り出していません。' : '支払いの画面を開けませんでした。少し待ってからもう一度お試しください。', true);
      again();
    }).catch(function () { msg('通信できませんでした。電波のよい所でもう一度お試しください。', true); again(); });
  });

  // Stripe から戻ってきた時: 支払い済みかをサーバーに確かめて、パスを受け取る。番号はアドレス欄から消す
  var sid = '';
  try { sid = new URLSearchParams(location.search).get('session_id') || ''; } catch (e) {}
  if (sid) {
    try { history.replaceState(null, '', location.pathname + '#pass'); } catch (e) {}
    msg('お支払いを確かめています…');
    post('/api/v1/pass/claim', { session_id: sid }).then(function (r) {
      if (r.status === 200 && r.data.token) {
        var saved = true;
        try { localStorage.setItem(PASS_KEY, r.data.token); } catch (e) { saved = false; }
        msg(saved ? 'ありがとうございます。パスを受け取りました。' : 'お支払いは済んでいますが、この端末にパスを保存できませんでした。ブラウザの設定（プライベートモードなど）をご確認のうえ、お問い合わせください。', !saved);
        render(null);
        return;
      }
      msg(r.status === 402 ? 'お支払いが確かめられませんでした。' : 'パスを受け取れませんでした。お支払いが済んでいる場合は、このページを開き直してください。', true);
    }).catch(function () { msg('通信できませんでした。お支払いが済んでいる場合は、電波のよい所でこのページを開き直してください。', true); });
  }

  render(null);
  fetch('/api/v1/pass/status').then(function (res) { return res.json(); }).then(render).catch(function () {});
})();
