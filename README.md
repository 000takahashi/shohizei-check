# 消費税1%チェッカー

令和9年4月〜令和11年3月の食料品の消費税1%に合わせて、飲食店と食品の仕入れ先が
本則課税・簡易課税・免税のどれが得かを試算し、届出と期限を出す静的サイト。
輸入利益チェッカー（yunyu-rieki）の姉妹サイト。

- `site/index.html` 画面（ビルドなし）、`site/calc.js` 計算（画面に依存しない純粋関数）
- テスト: `node --test tests/calc.test.js tests/seo.test.js`（依存なし。国税庁パンフの計算例2つを答えに使う）
- 出典: 国税庁「飲食料品に係る2年間の消費税率引下げについて」（令和8年9月）。法案は令和8年11月6日に衆議院で可決、参議院で審議中（未成立）
- 扱わないもの: 端数処理、簡易課税の75%ルール、インボイスの2割・3割特例、8%のまま残る定期便など
- 個別の税務相談にならないよう、結果は「目安」とし、最終判断は税理士・税務署へと出す

## 帳簿から読み込む（CSV）

画面の「帳簿から読み込む（CSV）」（`#bulk`）で、会計ソフトの取引・仕訳のCSVから、8%と10%の売上・仕入れを1年分（税抜き）に集めて試算の欄に入れます。
ファイルはブラウザの中だけで読み、サーバーにもAIにも送りません（通信なし・保存なし）。

- `site/csvkit.js`・`site/csvui.js`・`site/csvkit.css` 読み込みの道具と画面の部品。輸入利益チェッカー・免税チェッカーと同じファイル（直す時は3つそろえる）
- `site/bulk.js` 税区分の読み方（freee の1列型、マネーフォワード・弥生の借方・貸方型）と集計。テストは `tests/csv.test.js`
- 形の違う明細は、お客様のAIに整えてもらうお願い文（`AI_PROMPT`）を画面に出している

## 公開（Cloudflare Workers）

輸入利益チェッカーと同じ形。正式なURLは https://shohizei-check.com （2026-11-08 Cloudflare で購入）。

- `wrangler.jsonc` 設定。`site/` をそのまま配る。`routes` で独自ドメインと www をつなぐ
- `src/worker.js` www を正式なURLへ転送し、仮URL（`*.workers.dev`）に noindex を付ける
- `site/_headers` CSP など全ページ共通の守り。`site/robots.txt`・`site/sitemap.xml`・`site/llms.txt`（AI 向けの説明）
- 検索向けの構造化データ（JSON-LD）は画面の「よくある質問」から `node scripts/seo-sync.js` で作る。Google・Bing への登録手順は `docs/search-registration.md`
- 最初の1回だけ人の作業: Cloudflare の Workers & Pages で「Import a repository」からこのリポジトリを選ぶ
  （ビルドコマンドは空、デプロイコマンドは `npx wrangler deploy`）。以後は main への push で自動公開

