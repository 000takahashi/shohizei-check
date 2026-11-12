/* ご紹介の欄（3つのチェッカーで同じファイル。直す時は3つそろえる）
 * - 外部のスクリプトは読み込まない。X・LINE・Facebook へは、ふつうのリンクで渡すだけ（追跡なし）
 * - 「URLをコピー」「リンクのコードをコピー」だけをこのファイルで動かす */
(function () {
  'use strict';
  function copy(text, done) {
    function ok() { if (done) { done.textContent = 'コピーいたしました'; setTimeout(function () { done.textContent = ''; }, 2500); } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', '');
      t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); ok(); } catch (e) { /* 手で選んでいただく */ }
      document.body.removeChild(t);
    }
  }
  function init() {
    var box = document.getElementById('share');
    if (!box) return;
    var url = box.getAttribute('data-url');
    var done = box.querySelector('.share-done');
    var native = box.querySelector('[data-share-native]');
    if (native && navigator.share) {
      native.hidden = false;
      native.addEventListener('click', function () {
        navigator.share({ title: box.getAttribute('data-title'), text: box.getAttribute('data-text'), url: url }).catch(function () {});
      });
    }
    var c = box.querySelector('[data-share-copy]');
    if (c) c.addEventListener('click', function () { copy(url, done); });
    var cc = box.querySelector('[data-share-code]');
    var code = box.querySelector('textarea');
    if (cc && code) cc.addEventListener('click', function () { copy(code.value, cc.nextElementSibling); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
