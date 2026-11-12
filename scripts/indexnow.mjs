// IndexNow（Bing・Yandex・Naver などに「ページが変わりました」と知らせる。無料・登録なし）
// 使い方: node scripts/indexnow.mjs <host>
// - 送る URL は site/sitemap.xml の <loc> だけ（このリポジトリにある一覧＝作り話の URL を送らない）
// - 鍵は site/<鍵>.txt で公開するもの（秘密ではない）。鍵を変える時はファイル名と中身を一緒に
// - 公開の場で鍵のファイルが読めることを先に確かめ、読めなければ送らずに終わる（配信が遅れた時など）
import { readFileSync, readdirSync } from 'node:fs';

const host = process.argv[2];
if (!host) { console.error('host を指定してください'); process.exit(2); }

const keyFile = readdirSync('site').find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) { console.error('site/ に鍵のファイルがありません'); process.exit(2); }
const key = readFileSync(`site/${keyFile}`, 'utf8').trim();
if (`${key}.txt` !== keyFile) { console.error('鍵のファイル名と中身が合いません'); process.exit(2); }

const urls = [...readFileSync('site/sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((m) => m[1].trim())
  .filter((u) => new URL(u).host === host);
if (!urls.length) { console.log('送る URL がありません'); process.exit(0); }

const keyLocation = `https://${host}/${keyFile}`;
for (let i = 0; i < 10; i++) {
  const r = await fetch(keyLocation, { redirect: 'manual' }).catch(() => null);
  if (r && r.ok && (await r.text()).trim() === key) break;
  if (i === 9) { console.log('公開の場で鍵のファイルがまだ読めません。今回は送りません:', keyLocation); process.exit(0); }
  await new Promise((s) => setTimeout(s, 30000));
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
});
console.log(`IndexNow: ${res.status}（${urls.length}件）`);
// 200=受け付け、202=鍵の確認待ち（初回）。それ以外は失敗として知らせる
if (res.status !== 200 && res.status !== 202) process.exit(1);
