/*
 * 印刷の部品（3サイト共通・直す時は3つそろえる）
 * data-print の付いたボタンで印刷する。印刷の直前に、紙の上に
 * 「どのサイトで・いつ作ったか」の1行を入れる（何も送らない・何も保存しない）。
 */
(function (root) {
  'use strict';
  var doc = root.document;
  if (!doc) return;

  function today() {
    var d = new Date();
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function siteName() {
    var b = doc.querySelector('.brand-name');
    return b ? b.textContent.trim() : doc.title;
  }
  // いま開いている画面（hidden でない .view）の先頭に1行を置く
  function addHead() {
    var old = doc.querySelectorAll('.print-head');
    for (var i = 0; i < old.length; i++) old[i].remove();
    var views = doc.querySelectorAll('.view'), view = null;
    for (var j = 0; j < views.length; j++) if (!views[j].hidden) { view = views[j]; break; }
    if (!view) return;
    var h = doc.createElement('div'); h.className = 'print-head';
    var a = doc.createElement('span'); a.textContent = siteName() + '（' + root.location.host + '）で作成';
    var b = doc.createElement('span'); b.textContent = '印刷日：' + today() + '・結果は目安です';
    h.appendChild(a); h.appendChild(b);
    view.insertBefore(h, view.firstChild);
    // くわしい内訳（data-print-open）は、紙では開いた形で出す。印刷のあとで元に戻す
    var ds = view.querySelectorAll('details[data-print-open]:not([open])');
    for (var k = 0; k < ds.length; k++) { ds[k].open = true; ds[k].setAttribute('data-print-opened', ''); }
  }
  function restore() {
    var ds = doc.querySelectorAll('details[data-print-opened]');
    for (var i = 0; i < ds.length; i++) { ds[i].open = false; ds[i].removeAttribute('data-print-opened'); }
  }
  root.addEventListener('beforeprint', addHead);
  root.addEventListener('afterprint', restore);
  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-print]') : null;
    if (!t) return;
    e.preventDefault();
    addHead();
    root.print();
  });
  root.PrintKit = { addHead: addHead };
})(typeof self !== 'undefined' ? self : this);
