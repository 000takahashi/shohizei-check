// 見られた数・使われた数を、日ごとの合計だけ数える（2026-11-16）
// 目的：毎週の手直しが効いたかを、数字で確かめるため（何人来て、どの計算が使われ、パスが何回買われたか）。
// 記録するのは「日付（UTC）・サイト名・種類・ページや窓口の住所・参照元のサイト名・回数」だけ。
// IPアドレス・Cookie・ブラウザの詳しい情報・入力した数字・計算の結果は記録しない。
// しまう場所：D1「chronodrawer-reports」の ck_count と ck_count_day（wrangler.jsonc の COUNTS）。
// 表はこのコードが初回に作る。COUNTS が無い時・書けない時は何もしない（ページは必ずいつも通り返す）。
// 読むのは chronodrawer の .github/workflows/counts.yml（毎週の集計）。

export const DAY_LIMIT = 20000; // 1つのサイトの1日の行の上限（D1 を使い切らない）
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embed|curl|wget|python|headless|go-http-client|axios|okhttp|^java|libwww|node-fetch|undici|postman|httpie|scrapy|lighthouse/i;

/** 住所を短く、決まった形に（末尾の / と index.html を落とす・長さを切る） */
export function cleanPath(p) {
  let s = String(p || '/').toLowerCase().replace(/\/index\.html$/, '/').replace(/\/+$/, '');
  if (!s) s = '/';
  if (!/^\/[a-z0-9._\/-]*$/.test(s)) return 'other';
  return s.slice(0, 80);
}

/** 参照元のサイト名（自分のサイトと、読めない物は空） */
export function refHost(ref, ownHost) {
  try {
    const h = new URL(ref).hostname.toLowerCase().replace(/^www\./, '');
    if (!h || h === ownHost.replace(/^www\./, '')) return '';
    return /^[a-z0-9.-]{1,60}$/.test(h) ? h : '';
  } catch { return ''; }
}

/**
 * 1回の受け答えから、数える物を1つ決める（数えない時は null）。
 * api＝計算の窓口・パスの窓口・AI向けの窓口（/mcp）。AI やプログラムからの呼び出しも数えたいので、ロボットでも数える。k2 は ok／ng。
 * view＝人がページを開いた回数。ロボット・「追跡しないで」の設定は数えない。k2 は参照元のサイト名。
 */
export function pickEvent(request, response, isApi) {
  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') || '';
  if (isApi) {
    if (request.method === 'OPTIONS') return null;
    return { kind: 'api', k1: cleanPath(url.pathname), k2: response.status < 400 ? 'ok' : 'ng' };
  }
  if (request.method !== 'GET' || response.status !== 200) return null;
  if (!(response.headers.get('content-type') || '').includes('text/html')) return null;
  if (BOT.test(ua) || !ua) return null;
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return null;
  if (request.headers.get('purpose') === 'prefetch' || request.headers.get('sec-purpose')) return null;
  return { kind: 'view', k1: cleanPath(url.pathname), k2: refHost(request.headers.get('referer') || '', url.hostname) };
}

export const COUNT_SQL = [
  "CREATE TABLE IF NOT EXISTS ck_count (day TEXT NOT NULL, site TEXT NOT NULL, kind TEXT NOT NULL, k1 TEXT NOT NULL, k2 TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site, kind, k1, k2)) WITHOUT ROWID",
  'CREATE TABLE IF NOT EXISTS ck_count_day (day TEXT NOT NULL, site TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, site)) WITHOUT ROWID',
];
const FITS = 'WHERE COALESCE((SELECT n FROM ck_count_day WHERE day = ?1 AND site = ?2), 0) + 1 <= ?6';
const UPSERT = `INSERT INTO ck_count (day, site, kind, k1, k2, n) SELECT ?1, ?2, ?3, ?4, ?5, 1 ${FITS} ON CONFLICT(day, site, kind, k1, k2) DO UPDATE SET n = n + 1`;
const DAY_SQL = 'INSERT INTO ck_count_day (day, site, n) SELECT ?1, ?2, 1 WHERE COALESCE((SELECT n FROM ck_count_day WHERE day = ?1 AND site = ?2), 0) + 1 <= ?3 ON CONFLICT(day, site) DO UPDATE SET n = n + 1';

export async function writeCount(db, site, ev, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const stmts = [
    db.prepare(UPSERT).bind(day, site, ev.kind, ev.k1, ev.k2, DAY_LIMIT),
    db.prepare(DAY_SQL).bind(day, site, DAY_LIMIT),
  ];
  try {
    await db.batch(stmts);
  } catch (e) {
    if (!/no such table/i.test(String(e?.message || e))) throw e;
    for (const sql of COUNT_SQL) await db.prepare(sql).run();
    await db.batch(stmts);
  }
}

/** worker.js から呼ぶ。返事を待たせない（ctx.waitUntil）・失敗してもページに影響しない */
export function count(env, ctx, site, request, response, isApi) {
  try {
    const db = env && env.COUNTS;
    if (!db || !ctx || typeof ctx.waitUntil !== 'function') return;
    const ev = pickEvent(request, response, isApi);
    if (!ev) return;
    ctx.waitUntil(writeCount(db, site, ev).catch(() => {}));
  } catch { /* 数えられなくても何もしない */ }
}
