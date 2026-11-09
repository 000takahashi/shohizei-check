// 検索向けの構造化データ（JSON-LD）を、画面の「よくある質問」から作り直す。
// 使い方: node scripts/seo-sync.js        … site/index.html の JSON-LD を書き直す
//         node scripts/seo-sync.js --check … ずれていたら失敗する（テストからも呼ぶ）
const fs = require("node:fs");
const path = require("node:path");

const FILE = path.join(__dirname, "..", "site", "index.html");
const START = "<!-- seo:jsonld:start -->";
const END = "<!-- seo:jsonld:end -->";

function text(html) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html, re) {
  const m = html.match(re);
  if (!m) throw new Error("見つかりません: " + re);
  return text(m[1]);
}

function faqs(html) {
  const sec = html.match(/<section[^>]*id="v-faq"[\s\S]*?<\/section>\s*<\/section>/);
  if (!sec) throw new Error("よくある質問（v-faq）が見つかりません");
  const out = [];
  const re = /<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(sec[0]))) out.push({ q: text(m[1]), a: text(m[2]) });
  if (!out.length) throw new Error("質問が0件です");
  return out;
}

function build(html) {
  const url = meta(html, /<link rel="canonical" href="([^"]+)"/);
  const name = meta(html, /<title>([^｜<]+)/);
  const desc = meta(html, /<meta name="description" content="([^"]+)"/);
  const app = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name, url, description: desc,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Web",
    inLanguage: "ja",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "JPY" },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs(html).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const js = (o) => JSON.stringify(o, null, 2).replace(/</g, "\\u003c");
  return START + "\n<script type=\"application/ld+json\">\n" + js(app) + "\n</script>\n<script type=\"application/ld+json\">\n" + js(faq) + "\n</script>\n" + END;
}

function sync(html) {
  const block = build(html);
  const i = html.indexOf(START), j = html.indexOf(END);
  if (i >= 0 && j > i) return html.slice(0, i) + block + html.slice(j + END.length);
  return html.replace("</body>", block + "\n</body>");
}

module.exports = { build, sync, faqs, FILE };

if (require.main === module) {
  const html = fs.readFileSync(FILE, "utf8");
  const next = sync(html);
  if (process.argv.includes("--check")) {
    if (next !== html) { console.error("JSON-LD が画面の内容とずれています。node scripts/seo-sync.js を実行してください。"); process.exit(1); }
    console.log("JSON-LD は画面の内容と一致しています。");
  } else {
    fs.writeFileSync(FILE, next);
    console.log("JSON-LD を書き直しました（質問 " + faqs(html).length + " 件）。");
  }
}
