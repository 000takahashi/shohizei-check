// 解説ページ（site/guide/）が、画面の説明と同じ内容で出来ているかを確かめる。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const G = require("../scripts/build-guides.js");

const site = (f) => fs.readFileSync(path.join(__dirname, "..", "site", f), "utf8");
const files = G.build();

test("解説ページとサイトマップが、最新の画面から作り直した物と一致している", () => {
  for (const [rel, text] of Object.entries(files)) {
    assert.equal(site(rel), text, rel + " が古いままです。node scripts/build-guides.js を実行してください");
  }
});

test("解説ページごとに、題名・説明・正式なURLがあり、ほかのページと重なっていない", () => {
  const titles = new Set(), descs = new Set();
  for (const p of G.CFG.pages) {
    const html = files["guide/" + p.slug + "/index.html"];
    const url = G.CFG.site + "/guide/" + p.slug + "/";
    assert.ok(html.includes('<link rel="canonical" href="' + url + '">'), p.slug);
    assert.ok(site("sitemap.xml").includes("<loc>" + url + "</loc>"), p.slug);
    assert.ok(p.desc.length >= 50 && p.desc.length <= 140, p.slug + " の説明の長さ " + p.desc.length);
    assert.ok(!titles.has(p.title) && !descs.has(p.desc), p.slug);
    titles.add(p.title); descs.add(p.desc);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, p.slug);
    assert.ok(!/href="#/.test(html), p.slug + " に、ページの中だけのリンクが残っています");
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  }
});

test("解説ページから試算の画面と姉妹サイトへ、トップから解説ページへ行ける", () => {
  const html = files["guide/" + G.CFG.pages[0].slug + "/index.html"];
  assert.ok(html.includes('class="bk-btn primary" href="/"'));
  for (const s of G.CFG.sisters) assert.ok(html.includes('href="' + s.url + '"'));
  assert.ok(site("index.html").includes('href="/guide/"'));
});
