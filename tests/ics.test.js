// カレンダーのファイル（.ics）のテスト
const test = require("node:test");
const assert = require("node:assert/strict");
const Ics = require("../site/icskit.js");

test("期限の日を終日の予定にし、14日前と3日前に知らせる", () => {
  const s = Ics.build([{ date: "2026-12-31", title: "【期限】簡易課税制度選択届出書", note: "税務署に出します。目安です; 確かめてください" }], "20261112T000000Z");
  assert.ok(s.startsWith("BEGIN:VCALENDAR\r\n") && s.endsWith("END:VCALENDAR\r\n"));
  assert.ok(s.includes("DTSTART;VALUE=DATE:20261231\r\n"));
  assert.ok(s.includes("DTEND;VALUE=DATE:20270101\r\n"));
  assert.ok(s.includes("TRIGGER:-P14D") && s.includes("TRIGGER:-P3D"));
  assert.ok(s.includes("\;")); // 区切りの記号はよける
  for (const line of s.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, line);
});

test("日付の形が違う予定は入れない", () => {
  const s = Ics.build([{ date: "2026/12/31", title: "x" }, { date: "", title: "y" }], "20261112T000000Z");
  assert.ok(!s.includes("BEGIN:VEVENT"));
});
