/*
 * CSV 読み込みの画面の部品（3サイト共通）
 * ファイルを選ぶ・落とす・貼り付ける、列の当てはめ、ダウンロード、コピー。
 * 読んだ中身はこのページの中だけで使い、どこにも送らない（通信をしない）。
 */
(function (root) {
  'use strict';
  var K = root.CsvKit;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /*
   * 読み込みの入口をつなぐ。
   * opt = { zone, input, paste, pasteBtn, onText(text, info), onError(msg) }
   */
  function setupInput(opt) {
    function readFile(f) {
      if (!f) return;
      if (f.size > K.MAX_BYTES) { opt.onError('ファイルが大きすぎます（5MBまで）。'); return; }
      if (/\.(xlsx|xls|numbers|pdf)$/i.test(f.name)) {
        opt.onError('Excel や PDF のままでは読めません。Excel なら「名前を付けて保存」で「CSV」を選んでから読み込んでください。');
        return;
      }
      var fr = new FileReader();
      fr.onload = function () {
        var d = K.decode(fr.result);
        opt.onText(d.text, { name: f.name, encoding: d.encoding });
      };
      fr.onerror = function () { opt.onError('ファイルを読めませんでした。'); };
      fr.readAsArrayBuffer(f);
    }
    opt.input.addEventListener('change', function () { readFile(opt.input.files[0]); opt.input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      opt.zone.addEventListener(ev, function (e) { e.preventDefault(); opt.zone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      opt.zone.addEventListener(ev, function (e) { e.preventDefault(); opt.zone.classList.remove('is-over'); });
    });
    opt.zone.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      readFile(f);
    });
    if (opt.paste && opt.pasteBtn) {
      opt.pasteBtn.addEventListener('click', function () {
        var t = opt.paste.value;
        if (!t.trim()) { opt.onError('貼り付ける欄が空です。'); return; }
        opt.onText(t, { name: '貼り付けた表', encoding: '' });
      });
    }
  }

  /*
   * 列の当てはめの欄を作る。変えたら onChange(map) を呼ぶ。
   * fields = [{ key, label }], headers = ['見出し', ...], map = { key: 列の番号 }
   */
  function renderMapping(box, fields, headers, map, onChange) {
    box.innerHTML = '';
    fields.forEach(function (f) {
      var wrap = document.createElement('label');
      wrap.className = 'bk-map-item' + (map[f.key] === undefined ? '' : ' is-set');
      var span = document.createElement('span');
      span.textContent = f.label;
      var sel = document.createElement('select');
      var none = document.createElement('option');
      none.value = '';
      none.textContent = '（使わない）';
      sel.appendChild(none);
      headers.forEach(function (h, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = (h || '（見出しなし）') + '［' + (i + 1) + '列目］';
        sel.appendChild(o);
      });
      sel.value = map[f.key] === undefined ? '' : String(map[f.key]);
      sel.addEventListener('change', function () {
        var m = Object.assign({}, map);
        if (sel.value === '') delete m[f.key]; else {
          var col = Number(sel.value);
          Object.keys(m).forEach(function (k) { if (m[k] === col) delete m[k]; }); // 1つの列は1つの項目だけ
          m[f.key] = col;
        }
        onChange(m);
      });
      wrap.appendChild(span);
      wrap.appendChild(sel);
      box.appendChild(wrap);
    });
  }

  // 文字をファイルとして保存させる（Excel で文字化けしないよう BOM を付ける）
  function download(name, text) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function copy(text, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = 'コピーしました';
      setTimeout(function () { btn.textContent = old; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      ta.remove();
    }
  }

  root.CsvUI = { esc: esc, setupInput: setupInput, renderMapping: renderMapping, download: download, copy: copy };
})(typeof self !== 'undefined' ? self : this);
