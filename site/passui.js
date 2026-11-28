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

  var DEVICE_KEY = PASS_KEY + '_device', RECEIPT_KEY = PASS_KEY + '_receipt';
  var LIMIT_TEXT = 'このパスは、すでに3つのブラウザーで登録されています。お困りの時は、運営者情報のメールアドレスへご連絡ください。';
  // この端末のでたらめな番号。1つのパスで登録できるブラウザーは3つまで（名前などは入っていない）
  function deviceId() {
    var d = '';
    try { d = localStorage.getItem(DEVICE_KEY) || ''; } catch (e) {}
    if (/^[A-Za-z0-9_-]{8,32}$/.test(d)) return d;
    var a = new Uint8Array(16), abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    crypto.getRandomValues(a);
    d = Array.prototype.map.call(a, function (b) { return abc.charAt(b & 63); }).join('');
    try { localStorage.setItem(DEVICE_KEY, d); } catch (e) {}
    return d;
  }
  // 領収書（Stripe の領収書のページ）のアドレス。受け取った端末にだけ残す
  function okReceipt(u) { return typeof u === 'string' && u.indexOf('https://pay.stripe.com/receipts/') === 0; }
  function setReceipt(u) { if (okReceipt(u)) { try { localStorage.setItem(RECEIPT_KEY, u); } catch (e) {} } }
  function getReceipt() { var u = ''; try { u = localStorage.getItem(RECEIPT_KEY) || ''; } catch (e) {} return okReceipt(u) ? u : ''; }
  // 期限までの残り（3日を切ったら知らせる）
  var SOON_MS = 3 * 86400000;
  function leftText(ms) { return ms < 86400000 ? Math.max(1, Math.ceil(ms / 3600000)) + '時間' : Math.ceil(ms / 86400000) + '日'; }

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
    ['v-plan', 'v-price', 'v-pass'].forEach(function (id) {
      var head = document.querySelector('#' + id + ' .page-head-text');
      if (head) head.appendChild(el('p', until + 'まで、この機能を無料でご利用いただけます。ご登録もお支払いも不要です。' + S.paidStartText() + 'からは、有料パスが必要となります。', 'free-note'));
    });
  }

  S.FEATURES.forEach(function (t) { $('psFeatures').appendChild(el('li', t)); });
  (S.FREE_FEATURES || []).forEach(function (t) { $('psFree').appendChild(el('li', t)); });
  // 値段の表。1日あたりは四捨五入した目安
  S.PLANS.forEach(function (p) {
    var row = el('div', '', 'ps-pr'), left = el('div', '', 'ps-pr-l'), right = el('div', '', 'ps-pr-r');
    left.appendChild(el('b', p.days + '日間'));
    left.appendChild(el('span', (S.PLAN_FIT && S.PLAN_FIT[p.id]) || ''));
    right.appendChild(el('b', p.yen.toLocaleString('ja-JP') + '円'));
    right.appendChild(el('span', '税込・1日あたり約' + Math.round(p.yen / p.days) + '円'));
    row.appendChild(left); row.appendChild(right);
    $('psPriceRows').appendChild(row);
  });
  $('psPrice').textContent = 'どちらも、買った時から数えた日数だけ使えます。自動で更新されず、会員登録も要りません。';
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
    ['内容', '上記の内容でご利用いただけます。計算の結果は目安です。法案の成立を前提としています。'],
    ['価格', P.yen.toLocaleString('ja-JP') + '円（税込）。ほかにかかる費用は、通信料のみです。'],
    ['期間', 'お支払いの時点から' + P.days + '日間。自動で更新されません。期限の3日前から、このサイトを開いた時に画面の上でお知らせします（メールではお知らせしません）。' + (S.upgradeFrom(P.id) ? 'パスの有効期間中は、差額の' + S.upgradeFrom(P.id).yen.toLocaleString('ja-JP') + '円で' + S.upgradeFrom(P.id).to.days + '日間に切り替えられます。' : '')],
    ['支払い', 'クレジットカード・デビットカード。ご購入時に確定します。'],
    ['ご利用開始', 'お支払いが完了次第、すぐにご利用いただけます。'],
    ['キャンセル・返金', 'お支払い後のキャンセル・返金はお受けいたしかねます。当方の不具合によりご利用いただけなかった場合は、全額を返金します。'],
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
      ['支払い', 'クレジットカード・デビットカード。ご購入時に確定します。'],
      ['ご利用開始', 'お支払いが完了次第、すぐに有効期限が延長されます。'],
      ['キャンセル・返金', 'お支払い後のキャンセル・返金はお受けいたしかねます。当方の不具合によりご利用いただけなかった場合は、全額を返金します。'],
    ].forEach(function (r) { $('psUpTerms').appendChild(el('dt', r[0])); $('psUpTerms').appendChild(el('dd', r[1])); });
    $('psUpGo').textContent = '差額' + yen + '円で' + u.to.days + '日間に切り替える';
    $('psUpGo').dataset.plan = u.to.id;
  }

  function render(sale) {
    if (sale) recMode(!!sale.mail);
    if (sale) lastSale = sale; else sale = lastSale;
    var exp = expiryOf(getPass()), active = exp > Date.now();
    upgradeBox(active, exp);
    $('psHave').hidden = !active;
    if (active) {
      var left = exp - Date.now();
      $('psHaveText').textContent = 'パスをご利用いただけます。' + dateText(exp) + ' まで有効です。' + (left < SOON_MS ? 'まもなく期限です（あと' + leftText(left) + '）。' : '');
      var ru = getReceipt(), acts = $('psHave').querySelector('.bk-actions');
      if (ru && acts && !$('psReceipt')) { var ra = el('a', '領収書を開く（Stripe）', 'bk-btn'); ra.id = 'psReceipt'; ra.href = ru; ra.target = '_blank'; ra.rel = 'noopener'; acts.appendChild(ra); }
    }
    $('psKeep').hidden = !active;
    if (active) $('psKeepCode').value = getPass();
    if (!active && exp > 0) msg('以前のパスは有効期限が切れています。');
    var oldR = $('psOldReceipt'), oru = getReceipt();
    if (!active && exp > 0 && oru && !oldR) { oldR = el('a', '前のパスの領収書を開く（Stripe）', 'bk-btn'); oldR.id = 'psOldReceipt'; oldR.href = oru; oldR.target = '_blank'; oldR.rel = 'noopener'; var ob = el('div', '', 'bk-actions'); ob.appendChild(oldR); $('psMsg').parentNode.insertBefore(ob, $('psMsg').nextSibling); }
    if (oldR) oldR.parentNode.hidden = active;
    $('psBuy').hidden = !(sale && sale.onSale) || active;
    $('psSoon').hidden = !!(sale && sale.onSale) || active;
    if (S.freeOpen()) $('psSoon').textContent = S.freeText() + 'までは、パスなしですべての機能をご利用いただけます。パスは、' + S.paidStartText() + 'からご購入いただけます。';
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
    busy = true; $('psGo').disabled = true; msg('お支払いの画面を開いています…');
    post('/api/v1/pass/checkout', { plan: chosen }).then(function (r) {
      if (r.status === 200 && r.data.url && r.data.url.indexOf('https://checkout.stripe.com/') === 0) { location.href = r.data.url; return; }
      msg(r.status === 503 ? '現在、販売を開始していません。' : 'お支払いの画面を開けませんでした。恐れ入りますが、しばらくしてからもう一度お試しください。', true);
      busy = false; $('psGo').disabled = false;
    }).catch(function () { msg('通信できませんでした。恐れ入りますが、電波の良い場所でもう一度お試しください。', true); busy = false; $('psGo').disabled = false; });
  });

  $('psUpGo').addEventListener('click', function () {
    if (busy) return;
    busy = true; $('psUpGo').disabled = true; msg('お支払いの画面を開いています…');
    var again = function () { busy = false; $('psUpGo').disabled = false; };
    post('/api/v1/pass/checkout', { plan: $('psUpGo').dataset.plan, upgrade: true }, getPass()).then(function (r) {
      if (r.status === 200 && r.data.url && r.data.url.indexOf('https://checkout.stripe.com/') === 0) { location.href = r.data.url; return; }
      msg(r.status === 409 ? 'このパスは切り替えられません。有効期限が切れている場合は、新たにお求めください。' : r.status === 503 ? '現在、販売を開始していません。' : 'お支払いの画面を開けませんでした。恐れ入りますが、しばらくしてからもう一度お試しください。', true);
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
    msg('お支払いを確認しています…');
    var done = function () { busy = false; $('psRetryGo').disabled = false; };
    var retry = function (text) { msg(text, true); $('psRetry').hidden = false; done(); };
    var finish = function () { setPending(''); memSid = ''; done(); };
    post('/api/v1/pass/claim', { session_id: id, device: deviceId() }).then(function (r) {
      if (r.status === 200 && r.data.token) {
        var saved = true;
        try { localStorage.setItem(PASS_KEY, r.data.token); } catch (e) { saved = false; }
        if (!saved) {
          // パスを残せない端末。控えだけは画面に出して、写してもらう
          retry('お支払いは完了していますが、この端末にパスを保存できませんでした。ブラウザの設定（プライベートモードなど）をご確認のうえ、「パスを再度受け取る」を押してください。');
          $('psKeep').hidden = false; $('psKeepCode').value = r.data.token;
          return;
        }
        setReceipt(r.data.receiptUrl);
        finish();
        msg('ご購入いただき、誠にありがとうございます。パスを発行しました。' + dateText(Number(r.data.expiresAt) || expiryOf(r.data.token)) + ' まで有効です。下の「パスの控え」を保存しておいてください。');
        if (window.AdsUI) window.AdsUI.hideAll();
        releaseAds();
        render(null);
        return;
      }
      if (r.status === 403) { finish(); releaseAds(); msg((r.data && r.data.message) || LIMIT_TEXT, true); return; }
      if (r.status === 402) { finish(); releaseAds(); msg('お支払いを確認できませんでした。お支払いがお済みでない場合は、もう一度お手続きください。', true); return; }
      if (r.status === 410) { finish(); releaseAds(); msg('このお支払いのパスは、有効期限が切れています。', true); return; }
      if (r.status === 400 || r.status === 404) { finish(); releaseAds(); msg('お支払いの情報が見つかりませんでした。お支払いがお済みの場合は、お手数ですがお問い合わせください。', true); return; }
      retry('パスを発行できませんでした。お支払いの情報はこの端末に残っていますので、しばらくしてから「パスを再度受け取る」を押してください。');
    }).catch(function () { retry('通信できませんでした。お支払いの情報はこの端末に残っていますので、電波の良い場所で「パスを再度受け取る」を押してください。'); });
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
    if (expiryOf(code) <= Date.now()) { rmsg('この控えのパスは、有効期限（' + dateText(expiryOf(code)) + '）が切れています。', true); return; }
    $('psRestoreGo').disabled = true; rmsg('控えを確認しています…');
    post('/api/v1/pass/check', { device: deviceId() }, code).then(function (r) {
      $('psRestoreGo').disabled = false;
      if (r.status === 200 && r.data.ok) {
        try { localStorage.setItem(PASS_KEY, code); } catch (e) { rmsg('この端末にパスを保存できませんでした。ブラウザの設定（プライベートモードなど）をご確認ください。', true); return; }
        setReceipt(r.data.receiptUrl);
        $('psRestoreCode').value = '';
        rmsg('パスを戻しました。' + dateText(r.data.expiresAt) + ' まで有効です。');
        if (window.AdsUI) window.AdsUI.hideAll();
        render(null);
        return;
      }
      rmsg(r.status === 403 ? LIMIT_TEXT : r.status === 410 ? 'この控えのパスは、有効期限が切れています。' : r.status === 503 ? '現在、パスを確認できません。恐れ入りますが、しばらくしてからもう一度お試しください。' : 'この控えは確認できませんでした。お手数ですが、控えが途中で切れていないかご確認ください。', true);
    }).catch(function () { $('psRestoreGo').disabled = false; rmsg('通信できませんでした。恐れ入りますが、電波の良い場所でもう一度お試しください。', true); });
  });


  // ---------- 控えが無い時に取り戻す ----------
  var recMode = function () {};
  (function () {
    var restore = $('psRestoreMsg') && $('psRestoreMsg').parentNode;
    if (!restore || !restore.parentNode) return;
    var c = el('section', null, 'doc-card'); c.id = 'psRecover';
    c.appendChild(el('h3', '控えが無い時に取り戻す'));
    c.appendChild(el('p', 'お支払いの時に Stripe の画面で入れたメールアドレスと、お支払いに使ったカードの下4桁を入れてください。購入時のブラウザーを含め、1つのパスで登録できるブラウザーは3つまでです。登録を解除したブラウザーでも、保存済みのパスは有効期限まで使えます。'));
    var grid = el('div', null, 'ps-rec-grid');
    function field(label, id, type, mode, max, ac) {
      var l = el('label', label), i = document.createElement('input');
      i.type = type; i.id = id; i.inputMode = mode; i.maxLength = max; i.autocomplete = ac;
      l.appendChild(i); grid.appendChild(l); return i;
    }
    var em = field('メールアドレス', 'psRecEmail', 'email', 'email', 254, 'email');
    var l4 = field('カードの下4桁', 'psRecLast4', 'text', 'numeric', 4, 'off');
    c.appendChild(grid);
    var go = el('button', 'パスを取り戻す', 'bk-btn'); go.type = 'button'; go.id = 'psRecGo';
    var w = el('div', null, 'bk-actions'); w.appendChild(go); c.appendChild(w);
    var m = el('p', null, 'bk-msg'); m.id = 'psRecMsg'; m.setAttribute('role', 'status'); c.appendChild(m);
    c.appendChild(el('p', '入れた内容は、お支払いを探すためだけに Stripe へ送ります。当サイトには保存しません。うまくいかない時は、運営者情報のメールアドレスへ、お支払いの日時と金額をお知らせください。', 'bk-hint'));
    // メールでリンクを送る形（送る設定がある時だけ。上の欄の代わりに出す）
    var lb = el('div', null, 'ps-rec-link'); lb.hidden = true;
    lb.appendChild(el('p', 'お支払いの時に Stripe の画面で入れたメールアドレスを入れてください。そのアドレスに、パスを取り戻すリンクを送ります。リンクは30分だけ使えます。パスを使いたい端末で開いてください。'));
    var lg = el('div', null, 'ps-rec-grid'), ll = el('label', 'メールアドレス'), le = document.createElement('input');
    le.type = 'email'; le.id = 'psLinkEmail'; le.inputMode = 'email'; le.maxLength = 254; le.autocomplete = 'email'; ll.appendChild(le); lg.appendChild(ll); lb.appendChild(lg);
    var lgo = el('button', 'リンクを送る', 'bk-btn'); lgo.type = 'button'; lgo.id = 'psLinkGo';
    var lw = el('div', null, 'bk-actions'); lw.appendChild(lgo); lb.appendChild(lw);
    var lm = el('p', null, 'bk-msg'); lm.setAttribute('role', 'status'); lb.appendChild(lm);
    lb.appendChild(el('p', 'メールアドレスは、お支払いを探すためと、リンクを送るためだけに使います。当サイトには保存しません。メールが届かない時は、迷惑メールのフォルダもご確認ください。それでも届かない時は、運営者情報のメールアドレスへ、お支払いの日時と金額をお知らせください。', 'bk-hint'));
    c.appendChild(lb);
    var oldParts = [c.children[1], grid, w, m, c.children[c.children.length - 2]];
    recMode = function (mail) {
      lb.hidden = !mail;
      for (var i = 0; i < oldParts.length; i++) if (oldParts[i] && oldParts[i] !== lb) oldParts[i].hidden = !!mail;
    };
    function lmsg(text, isErr) { lm.textContent = text || ''; lm.className = 'bk-msg' + (isErr ? ' err' : ''); }
    lgo.addEventListener('click', function () {
      var email = le.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { lmsg('メールアドレスの形が正しくありません。', true); return; }
      lgo.disabled = true; lmsg('送っています…');
      post('/api/v1/pass/send-link', { email: email }).then(function (r) {
        lgo.disabled = false;
        if (r.status === 200) { lmsg('このアドレスでのお支払いが見つかれば、リンクを送りました。数分たっても届かない時は、迷惑メールのフォルダをご確認ください。続けて送れるのは10分おきです。'); return; }
        lmsg(r.status === 400 ? 'メールアドレスの形が正しくありません。' : '現在、リンクを送れません。恐れ入りますが、しばらくしてからもう一度お試しください。', true);
      }).catch(function () { lgo.disabled = false; lmsg('通信できませんでした。電波の良い場所でもう一度お試しください。', true); });
    });
    restore.parentNode.insertBefore(c, restore.nextSibling);
    function cmsg(text, isErr) { m.textContent = text || ''; m.className = 'bk-msg' + (isErr ? ' err' : ''); }
    go.addEventListener('click', function () {
      var email = em.value.trim(), last4 = l4.value.replace(/[^0-9]/g, '');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { cmsg('メールアドレスの形が正しくありません。', true); return; }
      if (!/^\d{4}$/.test(last4)) { cmsg('カードの下4桁を、数字4つで入れてください。', true); return; }
      go.disabled = true; cmsg('お支払いを探しています…');
      post('/api/v1/pass/recover', { email: email, last4: last4, device: deviceId() }).then(function (r) {
        go.disabled = false;
        if (r.status === 200 && r.data.token) {
          try { localStorage.setItem(PASS_KEY, r.data.token); } catch (e) { cmsg('この端末にパスを保存できませんでした。ブラウザの設定（プライベートモードなど）をご確認ください。', true); return; }
          setReceipt(r.data.receiptUrl);
          em.value = ''; l4.value = '';
          cmsg('パスを取り戻しました。' + dateText(Number(r.data.expiresAt) || expiryOf(r.data.token)) + ' まで有効です。');
          if (window.AdsUI) window.AdsUI.hideAll();
          render(null);
          return;
        }
        cmsg(r.status === 403 ? LIMIT_TEXT
          : r.status === 404 ? 'お支払いが見つかりませんでした。メールアドレスとカードの下4桁をお確かめください。'
          : r.status === 410 ? 'このお支払いのパスは、有効期限が切れています。'
          : r.status === 429 ? '違う番号が何度も入ったため、取り戻しを止めています。お手数ですが、運営者情報のメールアドレスへご連絡ください。'
          : r.status === 503 ? '現在、パスを取り戻せません。恐れ入りますが、しばらくしてからもう一度お試しください。'
          : '取り戻せませんでした。恐れ入りますが、しばらくしてからもう一度お試しください。', true);
      }).catch(function () { go.disabled = false; cmsg('通信できませんでした。電波の良い場所でもう一度お試しください。', true); });
    });
  })();

  // 期限の3日前から、どの画面でも上に知らせる
  (function () {
    var exp = expiryOf(getPass()), left = exp - Date.now(), main = $('views');
    if (!(left > 0 && left < SOON_MS) || !main) return;
    var p = el('p', '有料パスの期限まで、あと' + leftText(left) + 'です（' + dateText(exp) + ' まで）。', 'ps-soon'); p.setAttribute('role', 'status');
    var a = el('a', 'パスのページへ'); a.href = '#pass'; a.setAttribute('data-view', 'pass'); p.appendChild(a);
    main.insertBefore(p, main.firstChild);
  })();

  // メールのリンクで開いた時: そのリンクでパスを受け取る（リンクはアドレス欄から消す）
  (function () {
    var link = '';
    try { link = new URLSearchParams(location.search).get('link') || ''; } catch (e) {}
    if (!/^r1\.\d{1,12}\.cs_(test|live)_[A-Za-z0-9]{10,200}\.[A-Za-z0-9_-]{20,80}$/.test(link)) return;
    try { history.replaceState(null, '', location.pathname + '#pass'); } catch (e) {}
    msg('リンクを確かめています…');
    post('/api/v1/pass/claim-link', { link: link, device: deviceId() }).then(function (r) {
      if (r.status === 200 && r.data.token) {
        try { localStorage.setItem(PASS_KEY, r.data.token); } catch (e) { msg('この端末にパスを保存できませんでした。ブラウザの設定（プライベートモードなど）をご確認ください。', true); return; }
        setReceipt(r.data.receiptUrl);
        msg('パスを取り戻しました。' + dateText(Number(r.data.expiresAt) || expiryOf(r.data.token)) + ' まで有効です。下の「パスの控え」を保存しておいてください。');
        if (window.AdsUI) window.AdsUI.hideAll();
        render(null);
        return;
      }
      msg(r.status === 403 ? ((r.data && r.data.message) || LIMIT_TEXT)
        : r.status === 410 && r.data && r.data.error === 'link_expired' ? 'このリンクは期限（30分）が切れています。お手数ですが、下の「控えが無い時に取り戻す」から、もう一度リンクを送ってください。'
        : r.status === 410 ? 'このお支払いのパスは、有効期限が切れています。'
        : r.status === 400 ? 'このリンクは使えません。メールのリンクを、途中で切れないように開いてください。'
        : 'パスを受け取れませんでした。恐れ入りますが、しばらくしてからもう一度リンクを開いてください。', true);
    }).catch(function () { msg('通信できませんでした。電波の良い場所で、もう一度リンクを開いてください。', true); });
  })();

  render(null);
  fetch('/api/v1/pass/status').then(function (res) { return res.json(); }).then(render).catch(function () {});
})();
