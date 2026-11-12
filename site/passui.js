// 有料パスのページ（説明・買う・受け取る）と、特定商取引法に基づく表記。
// パスはこの端末（localStorage の shohizei_pass）にだけ入る。名前・メール・カードは入っていない。
(function () {
  'use strict';
  var S = window.ShopInfo;
  if (!S || !document.getElementById('v-pass')) return;
  var $ = function (id) { return document.getElementById(id); };
  var PASS_KEY = 'shohizei_pass';
  // Stripe から戻った時の支払いの番号。パスを受け取れるまで残す（通信に失敗しても、開き直せば受け取り直せる）
  var PENDING_KEY = 'shohizei_pass_pending';
  var busy = false;

  function el(tag, text, cls) { var e = document.createElement(tag); if (text) e.textContent = text; if (cls) e.className = cls; return e; }
  function getPass() { try { return localStorage.getItem(PASS_KEY) || ''; } catch (e) { return ''; } }
  // 印の中の期限（ミリ秒）。形が違えば 0
  function expiryOf(token) { var m = /^v1\.(\d{1,12})\./.exec(token || ''); return m ? Number(m[1]) * 1000 : 0; }
  // 期限は日本時間の日付と時刻で出す（どの国の端末でも同じ表示にする）
  function dateText(ms) {
    var d = new Date(ms + 9 * 3600000), p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getUTCFullYear() + '年' + (d.getUTCMonth() + 1) + '月' + d.getUTCDate() + '日 ' + p2(d.getUTCHours()) + '時' + p2(d.getUTCMinutes()) + '分（日本時間）';
  }
  function msg(text, isErr) { $('psMsg').textContent = text || ''; $('psMsg').className = 'bk-msg' + (isErr ? ' err' : ''); }

  // 無料開放の期間は、「有料」の印を「◯月◯日まで無料」に変え、有料の画面の上に知らせを出す
  if (S.freeOpen()) {
    var until = S.freeText();
    Array.prototype.forEach.call(document.querySelectorAll('.nav-paid'), function (n) { n.textContent = until + 'まで無料'; });
    Array.prototype.forEach.call(document.querySelectorAll('.plan-cta span'), function (n) { n.textContent = n.textContent.replace('（有料）', '（' + until + 'まで無料）'); });
    if ($('homeFree')) { $('homeFree').textContent = until + 'まで、「2年間の通しの見通し」と「持ち帰りの値付け」も無料でお使いいただけます。ご登録もお支払いも不要です。'; $('homeFree').hidden = false; }
    ['v-plan', 'v-price', 'v-pass'].forEach(function (id) {
      var head = document.querySelector('#' + id + ' .page-head-text');
      if (head) head.appendChild(el('p', until + 'まで、この機能を無料でご利用いただけます。ご登録もお支払いも不要です。翌日からは、有料パスが必要となります。', 'free-note'));
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
    $('psGo').textContent = P.days + '日間 ' + P.yen.toLocaleString('ja-JP') + '円で購入する';
  [
    ['内容', '上記の内容でご利用いただけます。計算の結果は目安でございます。法案の成立を前提としております。'],
    ['価格', P.yen.toLocaleString('ja-JP') + '円（税込）。ほかにかかる費用は、通信料のみでございます。'],
    ['期間', 'お支払いの時点から' + P.days + '日間。自動で更新されません。' + (S.upgradeFrom(P.id) ? 'パスの有効期間中は、差額の' + S.upgradeFrom(P.id).yen.toLocaleString('ja-JP') + '円で' + S.upgradeFrom(P.id).to.days + '日間に切り替えられます。' : '')],
    ['支払い', 'クレジットカード・デビットカード。ご購入時に確定いたします。'],
    ['ご利用開始', 'お支払いが完了次第、すぐにご利用いただけます。'],
    ['キャンセル・返金', 'お支払い後のキャンセル・返金はお受けいたしかねます。当方の不具合によりご利用いただけなかった場合は、全額を返金いたします。'],
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
    $('psUpText').textContent = '差額の' + yen + '円で、' + u.to.days + '日間のパスに切り替えられます。有効期限は ' + dateText(newExp) + ' まで延長されます。';
    $('psUpTerms').textContent = '';
    [
      ['内容', '現在のパスを、' + u.to.days + '日間のパスに切り替えます。ご利用いただける機能は同じです。'],
      ['価格', yen + '円（税込）。' + u.to.days + '日間の価格から、' + u.from.days + '日間の価格を差し引いた金額です。'],
      ['期間', '最初のお支払いの時点から' + u.to.days + '日間（' + dateText(newExp) + ' まで）。自動で更新されません。'],
      ['支払い', 'クレジットカード・デビットカード。ご購入時に確定いたします。'],
      ['ご利用開始', 'お支払いが完了次第、すぐに有効期限が延長されます。'],
      ['キャンセル・返金', 'お支払い後のキャンセル・返金はお受けいたしかねます。当方の不具合によりご利用いただけなかった場合は、全額を返金いたします。'],
    ].forEach(function (r) { $('psUpTerms').appendChild(el('dt', r[0])); $('psUpTerms').appendChild(el('dd', r[1])); });
    $('psUpGo').textContent = '差額' + yen + '円で' + u.to.days + '日間に切り替える';
    $('psUpGo').dataset.plan = u.to.id;
  }

  function render(sale) {
    if (sale) lastSale = sale; else sale = lastSale;
    var exp = expiryOf(getPass()), active = exp > Date.now();
    upgradeBox(active, exp);
    $('psHave').hidden = !active;
    if (active) $('psHaveText').textContent = 'パスをご利用いただけます。' + dateText(exp) + ' まで有効です。';
    $('psKeep').hidden = !active;
    if (active) $('psKeepCode').value = getPass();
    if (!active && exp > 0) msg('以前のパスは有効期限が切れております。');
    $('psBuy').hidden = !(sale && sale.onSale) || active;
    $('psSoon').hidden = !!(sale && sale.onSale) || active;
    if (S.freeOpen()) $('psSoon').textContent = S.freeText() + 'までは、パスなしですべての機能をご利用いただけます。パスは、その翌日からご購入いただけます。';
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
    busy = true; $('psGo').disabled = true; msg('お支払いの画面を開いております…');
    post('/api/v1/pass/checkout', { plan: chosen }).then(function (r) {
      if (r.status === 200 && r.data.url && r.data.url.indexOf('https://checkout.stripe.com/') === 0) { location.href = r.data.url; return; }
      msg(r.status === 503 ? '現在、販売を開始しておりません。' : 'お支払いの画面を開けませんでした。恐れ入りますが、しばらくしてからもう一度お試しください。', true);
      busy = false; $('psGo').disabled = false;
    }).catch(function () { msg('通信できませんでした。恐れ入りますが、電波の良い場所でもう一度お試しください。', true); busy = false; $('psGo').disabled = false; });
  });

  $('psUpGo').addEventListener('click', function () {
    if (busy) return;
    busy = true; $('psUpGo').disabled = true; msg('お支払いの画面を開いております…');
    var again = function () { busy = false; $('psUpGo').disabled = false; };
    post('/api/v1/pass/checkout', { plan: $('psUpGo').dataset.plan, upgrade: true }, getPass()).then(function (r) {
      if (r.status === 200 && r.data.url && r.data.url.indexOf('https://checkout.stripe.com/') === 0) { location.href = r.data.url; return; }
      msg(r.status === 409 ? 'このパスは切り替えられません。有効期限が切れている場合は、新たにお求めください。' : r.status === 503 ? '現在、販売を開始しておりません。' : 'お支払いの画面を開けませんでした。恐れ入りますが、しばらくしてからもう一度お試しください。', true);
      again();
    }).catch(function () { msg('通信できませんでした。恐れ入りますが、電波の良い場所でもう一度お試しください。', true); again(); });
  });

  // ---------- 支払いのあと、パスを受け取る ----------
  // 支払いの番号は、パスを受け取れるまでこの端末に残す。受け取れたら消す。
  // 受け取りが終わるまでは広告を読み込まない（adsui.js は window.AdsHold を見て待つ）。
  function getPending() { try { return localStorage.getItem(PENDING_KEY) || ''; } catch (e) { return ''; } }
  function setPending(v) { try { if (v) localStorage.setItem(PENDING_KEY, v); else localStorage.removeItem(PENDING_KEY); return true; } catch (e) { return false; } }
  function releaseAds() {
    window.AdsHold = false;
    try { document.dispatchEvent(new Event('ads:release')); } catch (e) {}
  }
  var sid = '', memSid = '';
  try { sid = new URLSearchParams(location.search).get('session_id') || ''; } catch (e) {}
  if (sid && !/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) sid = '';
  if (sid) {
    // 番号を端末に残せた時だけ、アドレス欄から消す（残せない時は、開き直しで受け取り直せるようアドレス欄に残す）
    if (setPending(sid)) { try { history.replaceState(null, '', location.pathname + '#pass'); } catch (e) {} }
    else memSid = sid;
  }
  function pendingSid() { return getPending() || memSid; }

  function claim() {
    var id = pendingSid();
    if (!id || busy) return;
    busy = true; $('psRetry').hidden = true; $('psRetryGo').disabled = true;
    msg('お支払いを確認しております…');
    var done = function () { busy = false; $('psRetryGo').disabled = false; };
    var retry = function (text) { msg(text, true); $('psRetry').hidden = false; done(); };
    var finish = function () { setPending(''); memSid = ''; done(); };
    post('/api/v1/pass/claim', { session_id: id }).then(function (r) {
      if (r.status === 200 && r.data.token) {
        var saved = true;
        try { localStorage.setItem(PASS_KEY, r.data.token); } catch (e) { saved = false; }
        if (!saved) {
          // パスを残せない端末。控えだけは画面に出して、写してもらう
          retry('お支払いは完了しておりますが、この端末にパスを保存できませんでした。ブラウザの設定（プライベートモードなど）をご確認のうえ、「パスを再度受け取る」を押してください。');
          $('psKeep').hidden = false; $('psKeepCode').value = r.data.token;
          return;
        }
        finish();
        msg('ご購入いただき、誠にありがとうございます。パスを発行いたしました。' + dateText(Number(r.data.expiresAt) || expiryOf(r.data.token)) + ' まで有効です。下の「パスの控え」を保存しておいてください。');
        if (window.AdsUI) window.AdsUI.hideAll();
        releaseAds();
        render(null);
        return;
      }
      if (r.status === 402) { finish(); releaseAds(); msg('お支払いを確認できませんでした。お支払いがお済みでない場合は、もう一度お手続きください。', true); return; }
      if (r.status === 410) { finish(); releaseAds(); msg('このお支払いのパスは、有効期限が切れております。', true); return; }
      if (r.status === 400 || r.status === 404) { finish(); releaseAds(); msg('お支払いの情報が見つかりませんでした。お支払いがお済みの場合は、お手数ですがお問い合わせください。', true); return; }
      retry('パスを発行できませんでした。お支払いの情報はこの端末に残っておりますので、しばらくしてから「パスを再度受け取る」を押してください。');
    }).catch(function () { retry('通信できませんでした。お支払いの情報はこの端末に残っておりますので、電波の良い場所で「パスを再度受け取る」を押してください。'); });
  }
  $('psRetryGo').addEventListener('click', claim);
  if (pendingSid()) { window.AdsHold = true; claim(); }

  // ---------- 控え ----------
  $('psKeepCopy').addEventListener('click', function () {
    var t = $('psKeepCode').value, ok = function () { $('psKeepCopy').textContent = 'コピーしました'; setTimeout(function () { $('psKeepCopy').textContent = '控えをコピーする'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { $('psKeepCode').select(); });
    else { $('psKeepCode').select(); try { document.execCommand('copy'); ok(); } catch (e) {} }
  });
  function rmsg(text, isErr) { $('psRestoreMsg').textContent = text || ''; $('psRestoreMsg').className = 'bk-msg' + (isErr ? ' err' : ''); }
  $('psRestoreGo').addEventListener('click', function () {
    var code = $('psRestoreCode').value.replace(/\s+/g, '');
    if (!/^v1\.\d{1,12}\.[A-Za-z0-9_-]{1,40}\.[A-Za-z0-9_-]{20,80}$/.test(code)) { rmsg('控えの形が正しくありません。「v1.」から最後まで、すべて貼り付けてください。', true); return; }
    if (expiryOf(code) <= Date.now()) { rmsg('この控えのパスは、有効期限（' + dateText(expiryOf(code)) + '）が切れております。', true); return; }
    $('psRestoreGo').disabled = true; rmsg('控えを確認しております…');
    post('/api/v1/pass/check', {}, code).then(function (r) {
      $('psRestoreGo').disabled = false;
      if (r.status === 200 && r.data.ok) {
        try { localStorage.setItem(PASS_KEY, code); } catch (e) { rmsg('この端末にパスを保存できませんでした。ブラウザの設定（プライベートモードなど）をご確認ください。', true); return; }
        $('psRestoreCode').value = '';
        rmsg('パスを戻しました。' + dateText(r.data.expiresAt) + ' まで有効です。');
        if (window.AdsUI) window.AdsUI.hideAll();
        render(null);
        return;
      }
      rmsg(r.status === 410 ? 'この控えのパスは、有効期限が切れております。' : r.status === 503 ? '現在、パスを確認できません。恐れ入りますが、しばらくしてからもう一度お試しください。' : 'この控えは確認できませんでした。お手数ですが、控えが途中で切れていないかご確認ください。', true);
    }).catch(function () { $('psRestoreGo').disabled = false; rmsg('通信できませんでした。恐れ入りますが、電波の良い場所でもう一度お試しください。', true); });
  });

  render(null);
  fetch('/api/v1/pass/status').then(function (res) { return res.json(); }).then(render).catch(function () {});
})();
