/*
 * CSV 読み込みの道具（3サイト共通・画面に依存しない）
 *
 * ファイルはブラウザの中だけで読む。サーバーにもAIにも送らない。
 * 輸入利益チェッカー・消費税1%チェッカー・免税チェッカーで同じファイルを使う
 * （直す時は3つのリポジトリをそろえる）。
 *
 *   decode(bytes)            UTF-8 か Shift_JIS（Excel の既定）かを見分けて文字にする
 *   parse(text)              CSV・タブ区切りを行の配列にする（"..." の中の改行・カンマも読む）
 *   findHeader(rows, fields) 見出しの行を探す（上に題名の行があっても飛ばす）
 *   guess(headers, fields)   見出しの言葉から「どの列が何か」を当てる
 *   num(s) / date(s)         「¥1,200」「1,200円」「2026/11/1」「令和8年11月1日」などを読む
 *   toCsv(rows)              結果を CSV の文字にする（Excel で文字化けしないよう BOM は呼ぶ側で付ける）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CsvKit = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_BYTES = 5 * 1024 * 1024; // 5MB まで（ブラウザが固まらないように）
  var MAX_ROWS = 5000;

  function decode(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'UTF-8' };
    }
    if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'UTF-16' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' };
    } catch (e) {
      try {
        return { text: new TextDecoder('shift_jis').decode(u8), encoding: 'Shift_JIS' };
      } catch (e2) {
        return { text: new TextDecoder('utf-8').decode(u8), encoding: 'UTF-8' };
      }
    }
  }

  // 区切り文字: 最初の数行で、カンマ・タブ・セミコロンのどれが一番多いか
  function sniff(text) {
    var head = text.split(/\r\n|\n|\r/).slice(0, 5).join('\n');
    var best = ',', bestN = 0;
    [',', '\t', ';'].forEach(function (d) {
      var n = head.split(d).length - 1;
      if (n > bestN) { best = d; bestN = n; }
    });
    return best;
  }

  function parse(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    var d = delim || sniff(text);
    var rows = [], row = [], cell = '', q = false, i = 0, c;
    while (i < text.length) {
      c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"' && cell === '') { q = true; i++; continue; }
      if (c === d) { row.push(cell); cell = ''; i++; continue; }
      if (c === '\r' || c === '\n') {
        row.push(cell); cell = '';
        rows.push(row); row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
        i++;
        if (rows.length > MAX_ROWS + 20) break;
        continue;
      }
      cell += c; i++;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    // 空の行は捨てる。前後の空白も落とす
    return rows
      .map(function (r) { return r.map(function (s) { return s.trim(); }); })
      .filter(function (r) { return r.some(function (s) { return s !== ''; }); });
  }

  // 見出しの言葉をそろえる（全角→半角、大文字→小文字、空白・記号を落とす）
  function norm(s) {
    s = String(s || '');
    if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase().replace(/[\s_\-・:：/／|()（）\[\]［］「」【】<>＜＞"'`]/g, '');
  }

  /*
   * fields = [{ key: 'qty', words: ['数量', '個数', 'qty'], not: ['単位'] }, ...]
   * 見出しが言葉と同じなら 3 点、言葉を含むなら 2 点（長い言葉ほど少し上）。
   * not の言葉を含む見出しは選ばない。1つの列は1つの項目にだけ使う。
   * 戻り値: { qty: 2, price: 5, ... }（列の番号。見つからない項目は入れない）
   */
  function guess(headers, fields) {
    var hs = headers.map(norm);
    var cands = [];
    fields.forEach(function (f, fi) {
      hs.forEach(function (h, ci) {
        if (!h) return;
        if ((f.not || []).some(function (w) { return h.indexOf(norm(w)) !== -1; })) return;
        var best = 0;
        (f.words || []).forEach(function (w, wi) {
          var nw = norm(w);
          if (!nw) return;
          var s = 0;
          if (h === nw) s = 3;
          else if (h.indexOf(nw) !== -1) s = 2 + Math.min(nw.length, 8) / 100;
          if (s) s -= wi / 1000; // 先に書いた言葉を少し優先
          if (s > best) best = s;
        });
        if (best) cands.push({ key: f.key, col: ci, score: best, order: fi });
      });
    });
    cands.sort(function (a, b) { return b.score - a.score || a.order - b.order || a.col - b.col; });
    var map = {}, used = {};
    cands.forEach(function (c) {
      if (map[c.key] !== undefined || used[c.col]) return;
      map[c.key] = c.col; used[c.col] = true;
    });
    return map;
  }

  // 上から10行のうち、項目の言葉に一番多く当たる行を見出しとみなす（無ければ1行目）
  function findHeader(rows, fields) {
    var best = 0, bestN = -1;
    for (var i = 0; i < Math.min(rows.length, 10); i++) {
      var n = Object.keys(guess(rows[i], fields)).length;
      if (n > bestN) { best = i; bestN = n; }
    }
    return best;
  }

  function num(s) {
    if (typeof s === 'number') return isFinite(s) ? s : NaN;
    s = String(s === undefined || s === null ? '' : s);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.trim();
    if (!s) return NaN;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/^[△▲]/.test(s)) { neg = true; s = s.slice(1); }
    s = s.replace(/[¥\\$€£,\s円元%]|ドル|ウォン|ユーロ|ポンド|jpy|usd|cny|rmb|krw|eur/gi, '');
    if (/^-/.test(s)) { neg = !neg; s = s.slice(1); }
    if (!/^\d*\.?\d+$/.test(s)) return NaN;
    var v = Number(s);
    return neg ? -v : v;
  }

  var ERA = { '令和': 2018, 'r': 2018, '平成': 1988, 'h': 1988 };
  function iso(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
    return t.toISOString().slice(0, 10);
  }
  function date(s) {
    s = String(s === undefined || s === null ? '' : s);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.trim().toLowerCase();
    var m;
    if ((m = /^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/.exec(s))) return iso(m[1], m[2], m[3]);
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return iso(m[1], m[2], m[3]);
    if ((m = /^(令和|平成|r|h)\s*(\d{1,2}|元)[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})日?/.exec(s))) {
      return iso(ERA[m[1]] + (m[2] === '元' ? 1 : Number(m[2])), m[3], m[4]);
    }
    return '';
  }

  function cell(v) {
    v = v === undefined || v === null ? '' : String(v);
    // 表計算ソフトで式として動かないように、= + - @ で始まる文字は ' を付ける（数字は除く）
    if (/^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function toCsv(rows) {
    return rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n') + '\r\n';
  }

  /*
   * 表を読む一式: 見出しの行を探し、列を当て、データの行を返す。
   * 戻り値: { headers, map, rows, headerRow, truncated }
   */
  function table(text, fields) {
    var all = parse(text);
    if (!all.length) return { headers: [], map: {}, rows: [], headerRow: 0, truncated: false };
    var h = findHeader(all, fields);
    var headers = all[h];
    var body = all.slice(h + 1);
    var truncated = body.length > MAX_ROWS;
    return { headers: headers, map: guess(headers, fields), rows: body.slice(0, MAX_ROWS), headerRow: h, truncated: truncated };
  }

  return { MAX_BYTES: MAX_BYTES, MAX_ROWS: MAX_ROWS, decode: decode, parse: parse, sniff: sniff, norm: norm, guess: guess, findHeader: findHeader, num: num, date: date, toCsv: toCsv, table: table };
});
