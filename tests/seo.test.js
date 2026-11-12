// 検索に載せるための設定が、そろっているかを確かめる。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../scripts/seo-sync.js");

const site = (f) => fs.readFileSync(path.join(__dirname, "..", "site", f), "utf8");
const html = site("index.html");
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)[1];

test("構造化データが画面の「よくある質問」と一致している", () => {
  assert.equal(S.sync(html), html, "node scripts/seo-sync.js を実行してください");
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = blocks.find((b) => b["@type"] === "FAQPage");
  assert.ok(faq.mainEntity.length >= 3);
  assert.equal(blocks.find((b) => b["@type"] === "WebApplication").url, canonical);
});

test("サイトマップと robots.txt が正式なURLを指している", () => {
  assert.match(site("robots.txt"), new RegExp("Sitemap: " + canonical + "sitemap.xml"));
  const sm = site("sitemap.xml");
  assert.ok(sm.includes("<loc>" + canonical + "</loc>"));
  assert.ok(sm.includes("<loc>" + canonical + "llms.txt</loc>"));
});

test("llms.txt があり、正式なURLが書いてある", () => {
  assert.ok(site("llms.txt").includes(canonical));
});

// ── 知ってもらう経路（SNSで共有された時の絵・ご紹介の欄・IndexNow の鍵）
test("SNSで共有された時の絵（og:image）が、正しい大きさで置いてある", () => {
  const img = html.match(/<meta property="og:image" content="([^"]+)"/);
  assert.ok(img, "og:image がありません");
  assert.equal(img[1], canonical + "og.png");
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  const png = fs.readFileSync(path.join(__dirname, "..", "site", "og.png"));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("ご紹介の欄は正式なURLを渡し、外部のスクリプトを読み込まない", () => {
  const box = html.match(/<section id="share"[^>]*data-url="([^"]+)"/);
  assert.ok(box, "ご紹介の欄がありません");
  assert.equal(box[1], canonical);
  assert.match(html, /<script src="share\.js" defer><\/script>/);
  const js = site("share.js");
  assert.doesNotMatch(js, /createElement\(["']script/);
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon/);
});

test("IndexNow の鍵のファイルは、名前と中身が同じ", () => {
  const keys = fs.readdirSync(path.join(__dirname, "..", "site")).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f));
  assert.equal(keys.length, 1);
  assert.equal(site(keys[0]).trim() + ".txt", keys[0]);
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "indexnow.yml"), "utf8");
  assert.ok(wf.includes("node scripts/indexnow.mjs " + new URL(canonical).host));
});
