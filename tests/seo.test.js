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
