// 広告枠（Google アドセンス）。輸入利益チェッカー・消費税1%チェッカー・免税チェッカーで同じファイル（直す時は3つそろえる）。
// - 有料パスが使える間は、広告のスクリプトを読み込まない（広告も、広告の Cookie も出さない）。
// - 広告の場所は、ページの <aside class="adslot" data-ad-slot="（広告ユニットの番号）"> だけ。
//   番号が空の枠は出さない（アドセンスの管理画面で自動広告をオンにした時は、Google が場所を決める）。
// - 枠は、画面に入った時に初めて広告を入れる（隠れている画面の枠に入れると、幅0で失敗するため）。
// - ?ads=preview で、広告の場所を点線の枠で確かめられる（広告は読み込まない）。
// 設定は <script src="adsui.js" data-client="ca-pub-…" data-pass-key="（パスを入れている localStorage の名前）">。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdsUI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SCRIPT = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js';

  // パスの印（v1.<期限の秒>.…）の期限（ミリ秒）。形が違えば 0
  function passExpiry(token) { var m = /^v1\.(\d{1,12})\./.exec(token || ''); return m ? Number(m[1]) * 1000 : 0; }
  function passActive(token, nowMs) { return passExpiry(token) > (nowMs == null ? Date.now() : nowMs); }
  function validClient(c) { return /^ca-pub-\d{10,20}$/.test(String(c || '')); }
  function validSlot(s) { return /^\d{5,20}$/.test(String(s || '')); }

  // 'ads'（広告を読み込む）・'preview'（枠だけ見せる）・'off'（何もしない）。
  // パスが使える人には、プレビューも含めて何も出さない
  function decide(opt) {
    opt = opt || {};
    if (passActive(opt.token, opt.now)) return 'off';
    if (opt.preview) return 'preview';
    return validClient(opt.client) ? 'ads' : 'off';
  }

  var state = { mode: 'off', client: '', io: null };

  function readPass(key) { if (!key) return ''; try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function slots() { return Array.prototype.slice.call(document.querySelectorAll('.adslot')); }

  // パスを買った直後など、いま出ている枠をすべて閉じる
  function hideAll() {
    state.mode = 'off';
    if (state.io) { state.io.disconnect(); state.io = null; }
    slots().forEach(function (el) { el.hidden = true; var b = el.querySelector('.adbox'); if (b) b.textContent = ''; });
  }

  function fill(el) {
    if (state.mode !== 'ads' || el.getAttribute('data-ad-filled')) return;
    el.setAttribute('data-ad-filled', '1');
    var ins = document.createElement('ins');
    ins.className = 'adsbygoogle'; ins.style.display = 'block';
    ins.setAttribute('data-ad-client', state.client);
    ins.setAttribute('data-ad-slot', el.getAttribute('data-ad-slot'));
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    el.querySelector('.adbox').appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
  }

  function loadScript(client) {
    if (document.querySelector('script[src^="' + SCRIPT + '"]')) return;
    var sc = document.createElement('script');
    sc.async = true; sc.crossOrigin = 'anonymous';
    sc.src = SCRIPT + '?client=' + client;
    document.head.appendChild(sc);
  }

  function start(cfg) {
    cfg = cfg || {};
    var mode = decide({ token: readPass(cfg.passKey), client: cfg.client, preview: /[?&]ads=preview\b/.test(location.search) });
    state.mode = mode; state.client = cfg.client || '';
    if (mode === 'off') return mode;
    if (mode === 'preview') {
      slots().forEach(function (el) {
        el.classList.add('preview');
        el.querySelector('.adbox').textContent = '広告枠（' + (el.getAttribute('data-ad-name') || el.id) + '）' + (validSlot(el.getAttribute('data-ad-slot')) ? '' : '・番号未設定');
        el.hidden = false;
      });
      return mode;
    }
    loadScript(cfg.client);
    var ready = slots().filter(function (el) { return validSlot(el.getAttribute('data-ad-slot')); });
    ready.forEach(function (el) { el.hidden = false; });
    if ('IntersectionObserver' in window) {
      state.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting && en.boundingClientRect.width > 0) { fill(en.target); state.io && state.io.unobserve(en.target); } });
      }, { rootMargin: '200px 0px' });
      ready.forEach(function (el) { state.io.observe(el); });
    } else {
      ready.forEach(fill);
    }
    return mode;
  }

  // ページに置いた <script src="adsui.js" data-…> の設定で、自動で始める
  if (typeof document !== 'undefined' && document.currentScript) {
    var me = document.currentScript;
    var cfg = { client: me.getAttribute('data-client'), passKey: me.getAttribute('data-pass-key') };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { start(cfg); });
    else start(cfg);
  }

  return { passExpiry: passExpiry, passActive: passActive, validClient: validClient, validSlot: validSlot, decide: decide, start: start, hideAll: hideAll };
});
