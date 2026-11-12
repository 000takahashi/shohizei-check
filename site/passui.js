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
    ['期間', 'お支払いの時から' + P.days + '日間。自動で更新されません。'],
    ['支払い', 'クレジットカード・デビットカード。ご購入の時に確定します。'],
    ['使える時期', 'お支払いが済むと、すぐに使えます。'],
    ['キャンセル・返金', 'お支払いの後は、キャンセル・返金できません。当方の不具合で使えなかった場合は、全額を返金します。'],
  ].forEach(function (r) { $('psTerms').appendChild(el('dt', r[0])); $('psTerms').appendChild(el('dd', r[1])); });
  }
  terms();

  function render(sale) {
    var exp = expiryOf(getPass()), active = exp > Date.now();
    $('psHave').hidden = !active;
    if (active) $('psHaveText').textContent = 'パスが使えます。' + dateText(exp) + ' まで有効です。';
    if (!active && exp > 0) msg('前のパスは期限が切れました。');
    $('psBuy').hidden = !(sale && sale.onSale) || active;
    $('psSoon').hidden = !!(sale && sale.onSale) || active;
  }

  // 表記のページ。販売者の表示が入るまでは「準備中」
  var rows = S.legalRows();
  $('lgSoon').hidden = rows.length > 0;
  $('lgBody').hidden = !rows.length;
  if (rows.length) {
    $('lgNote').textContent = S.legalNote();
    rows.forEach(function (r) { var tr = document.createElement('tr'); tr.appendChild(el('th', r[0])); tr.appendChild(el('td', r[1])); $('lgRows').appendChild(tr); });
  }

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })
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
