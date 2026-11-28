// 更新中の画面（2026-11-25〜・見直しのあいだ一時的に公開を休む）
//
// ■ 元に戻すとき：下の MAINTENANCE を false に書きかえて main へ入れる（この1行だけ）。
//   元のページ・計算・AI 向けの窓口のコードは何も消していない。false にすれば前と同じに動く。
//
// ■ 休んでいるあいだの返し方
//   - ページ：「ただいま更新中です」の画面を HTTP 503（一時的に休み）と Retry-After で返す。
//     検索エンジンには「一時的な休み」と伝わる。noindex は付けない（付けると検索から外れる）。
//   - /mcp と /api/*：同じく 503 で、休んでいる旨の JSON を返す。
//   - robots.txt・ads.txt・IndexNow の鍵・アイコン・OG画像だけは、そのまま返す。
//
// テストでは env.MAINTENANCE = 'off' を渡すと休まない（元の動きを確かめるため）。
export const MAINTENANCE = false;

const SITE = {
  name: '消費税1%チェッカー',
  contact: 'contact@shohizei-check.com',
  accent: '#2563eb',
  soft: '#eff6ff',
  accentDark: '#60a5fa',
  nameEn: 'Food 1% Consumption Tax Checker',
  what: '飲食店・食品のお店向けに、食料品の消費税1%（法案）で本則課税・簡易課税・免税のどれが少なくなるかと、届出の期限を試算する無料ツールです。',
  whatEn: 'A free tool for restaurants and food shops in Japan: it compares consumption-tax filing methods under the proposed 1% food rate.',
  softDark: '#172554'
};

// 案内を書き直した日（画面に出す）
const NOTICE_UPDATED = '2026年11月26日';
const NOTICE_UPDATED_EN = '26 November 2026';

const PASS_THROUGH = new Set(['/robots.txt', '/ads.txt', '/favicon.svg', '/apple-touch-icon.png', '/og.png']);
const RETRY_AFTER = '86400'; // 1日後にまた来てください、の目安（秒）

export function maintenanceOn(env) {
  return MAINTENANCE && !(env && env.MAINTENANCE === 'off');
}

export function passThrough(path) {
  return PASS_THROUGH.has(path) || /^\/[0-9a-f]{32}\.txt$/.test(path);
}

const HEADERS = {
  'Retry-After': RETRY_AFTER,
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
};

export function maintenanceResponse(path) {
  if (path === '/mcp' || path.startsWith('/api/')) {
    return new Response(JSON.stringify({
      error: 'maintenance',
      message: `${SITE.name}は、内容を見直すため一時的に公開を休止しております。`,
      message_en: 'This service is temporarily closed for updates.',
    }), { status: 503, headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });
  }
  return new Response(page(path.startsWith('/en/') || path === '/en'), {
    status: 503,
    headers: {
      ...HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  });
}

function page(en) {
  const year = new Date().getUTCFullYear();
  const body = en ? `<p class="what">${SITE.whatEn}</p>
<h1>This site is temporarily closed while we review it</h1>
<p>Thank you for using the ${SITE.name} (${SITE.nameEn}). We are checking the calculations and the screens so they are more accurate and easier to use. We apologize for the inconvenience.</p>
<p class="sub">We will announce the reopening date on this page as soon as it is decided. No pass has been sold yet, so nothing is being charged while the site is closed.</p>
<a class="contact" href="mailto:${SITE.contact}"><span>Questions? Email us (we usually reply within 3 business days)</span><b>${SITE.contact}</b></a>
<p class="upd">Notice updated: ${NOTICE_UPDATED_EN}</p>` : `<p class="what">${SITE.what}</p>
<h1><span>ただいま、内容の見直しのため</span><span>公開を休止しております</span></h1>
<p>${SITE.name}をご利用いただき、ありがとうございます。計算の正確さと使いやすさをいっそう高めるため、一時的にサービスを休止しております。ご不便をおかけし、誠に申し訳ございません。</p>
<p class="sub">再開の時期は、決まりしだい、このページでお知らせいたします。</p>
<p class="sub">有料パスの販売は2027年1月1日からの予定で、まだ始まっていません。休止のあいだに料金がかかることはありません。</p>
<a class="contact" href="mailto:${SITE.contact}"><span>お問い合わせはメールでどうぞ（3営業日以内にお返しします）</span><b>${SITE.contact}</b></a>
<p class="upd">この案内の更新日：${NOTICE_UPDATED}</p>
<p class="en" lang="en">${SITE.nameEn}: this site is temporarily closed for review. We will announce the reopening here. Questions: ${SITE.contact}</p>`;
  return `<!doctype html>
<html lang="${en ? 'en' : 'ja'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${en ? 'Temporarily closed｜' + SITE.nameEn : 'ただいま更新中です｜' + SITE.name}</title>
<meta name="theme-color" content="${SITE.accent}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1c1c1a;--sub:#55554f;--line:#e4e4df;--accent:${SITE.accent};--soft:${SITE.soft}}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--card:#1b1b1a;--ink:#f1f1ee;--sub:#b9b9b2;--line:#33332f;--accent:${SITE.accentDark};--soft:${SITE.softDark}}}
*{box-sizing:border-box}
html,body{margin:0}
body{min-height:100vh;display:flex;flex-direction:column;background:var(--bg);color:var(--ink);font-family:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic",Meiryo,system-ui,sans-serif;line-height:1.9;-webkit-text-size-adjust:100%}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:32px 16px}
.card{width:100%;max-width:560px;background:var(--card);border:1px solid var(--line);border-top:4px solid var(--accent);border-radius:12px;padding:36px 28px}
.site{display:flex;align-items:center;gap:10px;font-weight:700;font-size:15px;color:var(--accent);margin:0 0 6px}
.site img{width:28px;height:28px}
.what{color:var(--sub);font-size:14px;line-height:1.7;margin:0 0 20px}
h1{font-size:22px;line-height:1.5;margin:0 0 16px}
h1 span{display:inline-block}
@media (max-width:420px){h1{font-size:20px}.card{padding:28px 20px}}
p{margin:0 0 14px;font-size:16px}
.sub{color:var(--sub);font-size:15px}
.contact{display:block;margin-top:24px;padding:14px 16px;min-height:48px;background:var(--soft);border-radius:8px;font-size:15px;color:var(--ink);text-decoration:none}
.contact span{display:block}
.contact b{display:block;color:var(--accent);word-break:break-all;text-decoration:underline}
.contact:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.upd{margin-top:16px;color:var(--sub);font-size:13px}
.en{margin-top:20px;padding-top:16px;border-top:1px solid var(--line);color:var(--sub);font-size:14px;line-height:1.7}
footer{text-align:center;color:var(--sub);font-size:13px;padding:0 16px 24px}
</style>
</head>
<body>
<main>
<div class="card">
<p class="site"><img src="/favicon.svg" alt="" width="28" height="28">${en ? SITE.nameEn : SITE.name}</p>
${body}
</div>
</main>
<footer>© ${year} ${en ? 'Checker Henshushitsu' : 'チェッカー編集室'}</footer>
</body>
</html>`;
}
