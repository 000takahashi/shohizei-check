// 解説ページ（site/guide/）を作るスクリプト。
// 使い方: node scripts/build-guides.js         … site/guide/ と sitemap.xml を書き直す
//         node scripts/build-guides.js --check … 出来上がりが古いままなら失敗する（テストからも呼ぶ）
//
// 検索で来た方が、知りたい話題のページに直接たどり着けるようにするためのページです。
// 本文は site/index.html の各画面（v-〇〇）からそのまま取り出します。ここに本文を書き写さない。
// index.html の説明を直したら、このスクリプトを流し直してコミットする（tests/guides.test.js が見張ります）。
const fs = require("node:fs");
const path = require("node:path");
const CFG = require("./guides.config.js");

const ROOT = path.join(__dirname, "..");
const SITE_DIR = path.join(ROOT, "site");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const strip = (s) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

// 画面（<section id="v-〇〇">）の中身を取り出す。入れ子の <section> を数えて、対応する閉じタグまで。
function viewBody(html, view) {
  const m = new RegExp('<section class="view[^"]*" id="v-' + view + '"[^>]*>').exec(html);
  if (!m) throw new Error("画面が見つかりません: v-" + view);
  const re = /<section\b|<\/section>/g;
  re.lastIndex = m.index + m[0].length;
  let depth = 1, x;
  while (depth && (x = re.exec(html))) depth += x[0] === "</section>" ? -1 : 1;
  if (depth) throw new Error("画面の終わりが見つかりません: v-" + view);
  return html.slice(m.index + m[0].length, x.index);
}

// 画面の中のリンク（#calc など）を、トップページのその画面へのリンクに直す。広告の枠と印刷ボタンは外す。
function clean(body) {
  return body
    .replace(/<div class="page-head">[\s\S]*?<\/div>\s*<\/div>/, "")
    .replace(/<aside class="adslot"[\s\S]*?<\/aside>/g, "")
    .replace(/<div class="bk-actions[^"]*">\s*<button[^>]*data-print[^>]*>[\s\S]*?<\/button>\s*<\/div>/g, "")
    .replace(/ data-view="[^"]*"/g, "")
    .replace(/href="#([a-z]+)"/g, 'href="/#$1"')
    .trim();
}

function faqLd(body) {
  const out = [];
  const re = /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(body))) out.push({ "@type": "Question", name: strip(m[1]), acceptedAnswer: { "@type": "Answer", text: strip(m[2]) } });
  return out.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: out } : null;
}

const ld = (o) => '<script type="application/ld+json">' + JSON.stringify(o).replace(/</g, "\\u003c") + "</script>";

function shell(o) {
  const url = CFG.site + o.path;
  const crumbs = [{ name: CFG.name, item: CFG.site + "/" }].concat(o.path === "/guide/" ? [] : [{ name: "解説", item: CFG.site + "/guide/" }], [{ name: o.h1, item: url }]);
  const blocks = [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: c.item })) },
  ];
  if (o.article) blocks.push({ "@context": "https://schema.org", "@type": "Article", headline: o.h1, description: o.desc, inLanguage: "ja", mainEntityOfPage: url, dateModified: CFG.updated, author: { "@type": "Organization", name: CFG.operator }, publisher: { "@type": "Organization", name: CFG.operator } });
  if (o.faq) blocks.push(o.faq);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(o.title)}｜${esc(CFG.name)}</title>
<meta name="description" content="${esc(o.desc)}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="${url}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=M+PLUS+2:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/guide/guide.css">
${blocks.map(ld).join("\n")}
</head>
<body class="g-body">
<header class="g-head"><a class="g-brand" href="/">${esc(CFG.name)}</a><a class="g-try" href="/">${esc(CFG.cta)}</a></header>
<main class="g-main">
<nav class="g-crumbs" aria-label="現在の位置">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${c.item.replace(CFG.site, "") || "/"}">${esc(c.name)}</a>` : `<span>${esc(c.name)}</span>`)).join("<i>›</i>")}</nav>
<div class="view doc">
<div class="page-head"><div class="page-head-text"><p class="kicker">${esc(o.kicker)}</p><h1 class="page-title">${esc(o.h1)}</h1><p class="lead">${o.lead}</p></div></div>
${o.body}
<section class="doc-card g-cta">
<h2>${esc(CFG.ctaTitle)}</h2>
<p>${esc(CFG.ctaText)}</p>
<p class="bk-actions"><a class="bk-btn primary" href="/">${esc(CFG.cta)}</a>${o.path === "/guide/" ? "" : '<a class="bk-btn" href="/guide/">ほかの解説を見る</a>'}</p>
</section>
${o.more || ""}
<section class="doc-card g-sisters">
<h2>姉妹サイトのご案内</h2>
<ul>${CFG.sisters.map((s) => `<li><a href="${s.url}">${esc(s.name)}</a>：${esc(s.text)}</li>`).join("")}</ul>
</section>
</div>
</main>
<footer class="g-foot"><p><a href="/">${esc(CFG.name)}</a><a href="/guide/">解説の一覧</a><a href="/#about">運営者情報・プライバシーポリシー</a></p><p>${esc(CFG.footNote)}</p></footer>
</body>
</html>
`;
}

// index.html の <style> をそのまま使い、解説ページだけの枠を足す（色や部品の見た目をトップとそろえるため）
function css(html) {
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1].trim());
  return "/* scripts/build-guides.js が site/index.html の <style> から作ります。直接は直さない。 */\n" + styles.join("\n") + `
/* 解説ページの枠 */
body.g-body { display: block; margin: 0; background: var(--bg); color: var(--ink); }
.g-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--paper); border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
.g-brand { font-weight: 700; color: var(--ink); text-decoration: none; }
.g-try { flex: none; padding: 8px 14px; border-radius: 999px; background: var(--accent); color: #fff; font-weight: 600; font-size: .88rem; text-decoration: none; }
.g-main { max-width: 780px; margin: 0 auto; padding: 16px 16px 40px; }
.g-main .view { display: block; }
.g-crumbs { font-size: .82rem; color: var(--muted); margin: 4px 0 14px; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.g-crumbs a { color: var(--muted); }
.g-crumbs i { font-style: normal; }
.g-main .doc-card h2 { margin: 0 0 14px; font-size: 1.02rem; font-weight: 700; letter-spacing: .04em; }
.g-main h1.page-title { font-size: 1.5rem; line-height: 1.4; margin: 4px 0 8px; }
.g-main .bk-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0 0; }
.g-main .bk-btn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--paper); color: var(--ink); font-weight: 600; text-decoration: none; }
.g-main .bk-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.g-list a.g-item { text-decoration: none; }
.g-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.g-list a.g-item { display: block; padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--paper); color: var(--ink); }
.g-list a.g-item b { display: block; color: var(--accent); margin-bottom: 2px; }
.g-list a.g-item span { font-size: .9rem; color: var(--ink-secondary); }
.g-table { width: 100%; border-collapse: collapse; font-size: .9rem; min-width: 560px; }
.g-table th, .g-table td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.g-table thead th { font-size: .8rem; color: var(--muted); font-weight: 600; }
.g-main .table-wrap { overflow-x: auto; }
.g-main .neg { color: var(--bad); font-weight: 600; }
@media (max-width: 640px) {
  .g-table { min-width: 0; }
  .g-table thead { display: none; }
  .g-table tr { display: block; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .g-table th, .g-table td { display: block; border: 0; padding: 2px 0; }
  .g-table td::before { content: attr(data-l) "："; color: var(--muted); font-size: .8rem; display: block; }
}
.g-foot { max-width: 780px; margin: 0 auto; padding: 0 16px 40px; font-size: .82rem; color: var(--muted); }
.g-foot a { margin-right: 16px; color: var(--muted); }
`;
}

function build() {
  const html = fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8");
  const files = {};
  files["guide/guide.css"] = css(html);
  const list = (skip) => `<ul class="g-list">${CFG.pages.filter((p) => p.slug !== skip).map((p) => `<li><a class="g-item" href="/guide/${p.slug}/"><b>${esc(p.h1)}</b><span>${esc(p.desc)}</span></a></li>`).join("")}</ul>`;
  for (const p of CFG.pages) {
    // body があるページは、設定に書いた本文を使う（計算機と同じ calc.js を渡すので、期限などの数字は計算機と同じになる）
    const raw = p.body ? "" : viewBody(html, p.view);
    const lead = p.body ? p.lead : (raw.match(/<p class="lead">([\s\S]*?)<\/p>/) || [, ""])[1];
    const body = p.body ? p.body(require("../site/calc.js")).trim() : clean(raw);
    files["guide/" + p.slug + "/index.html"] = shell({
      path: "/guide/" + p.slug + "/", title: p.title, h1: p.h1, desc: p.desc, kicker: "解説", lead: lead || esc(p.desc), body, article: true,
      faq: p.faq ? faqLd(body) : null,
      more: `<section class="doc-card"><h2>ほかの解説</h2>${list(p.slug)}</section>`,
    });
  }
  files["guide/index.html"] = shell({
    path: "/guide/", title: CFG.indexTitle, h1: CFG.indexTitle, desc: CFG.indexDesc, kicker: "解説", lead: esc(CFG.indexDesc),
    body: `<section class="doc-card"><h2>解説の一覧</h2>${list()}</section>`,
  });
  // サイトマップ：解説ページの行だけを入れ替える（ほかの行はそのまま）
  const sm = fs.readFileSync(path.join(SITE_DIR, "sitemap.xml"), "utf8");
  const kept = sm.split("\n").filter((l) => !l.includes(CFG.site + "/guide/"));
  const rows = ["/guide/"].concat(CFG.pages.map((p) => "/guide/" + p.slug + "/")).map((u) => `  <url><loc>${CFG.site}${u}</loc><lastmod>${CFG.updated}</lastmod></url>`);
  const at = kept.findIndex((l) => l.includes("</urlset>"));
  files["sitemap.xml"] = kept.slice(0, at).concat(rows, kept.slice(at)).join("\n");
  return files;
}

module.exports = { build, CFG };

if (require.main === module) {
  const files = build();
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(SITE_DIR, rel);
    const now = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    if (now === text) continue;
    stale++;
    if (!check) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  }
  if (check && stale) { console.error("解説ページが古いままです。node scripts/build-guides.js を実行してください。"); process.exit(1); }
  console.log(check ? "解説ページは最新です。" : "解説ページを書き直しました（" + stale + " ファイル）。");
}
