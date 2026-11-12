// 届出の期限を、カレンダーのファイル（.ics）にする。画面に依存しない。どこにも送らない。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IcsKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); }
  function ymd(iso) { return iso.replace(/-/g, ''); }
  function nextDay(iso) { return new Date(Date.parse(iso + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); }
  // 1行は75バイトまで（決まり）。日本語は3バイトなので、文字ごとに数えて折る
  function fold(line) {
    var out = '', n = 0;
    for (var i = 0; i < line.length; i++) {
      var c = line[i], b = c.charCodeAt(0) < 0x80 ? 1 : 3;
      if (n + b > 73) { out += '\r\n '; n = 1; }
      out += c; n += b;
    }
    return out;
  }
  /**
   * @param events [{ date:'YYYY-MM-DD', title, note }] 期限の日（終日の予定）。14日前と3日前に知らせる。
   * @param stamp  作った時刻（YYYYMMDDTHHMMSSZ）
   */
  function build(events, stamp) {
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//shohizei-check.com//todokede//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    (events || []).forEach(function (e, i) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) return;
      L.push('BEGIN:VEVENT', 'UID:' + ymd(e.date) + '-' + i + '@shohizei-check.com', 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + ymd(e.date), 'DTEND;VALUE=DATE:' + ymd(nextDay(e.date)),
        'SUMMARY:' + esc(e.title), 'DESCRIPTION:' + esc(e.note), 'TRANSP:TRANSPARENT');
      [14, 3].forEach(function (d) { L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), 'TRIGGER:-P' + d + 'D', 'END:VALARM'); });
      L.push('END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }
  return { build: build, fold: fold };
});
