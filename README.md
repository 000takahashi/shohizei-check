# 消費税1%チェッカー

令和9年4月〜令和11年3月の食料品の消費税1%に合わせて、飲食店と食品の仕入れ先が
本則課税・簡易課税・免税のどれが得かを試算し、届出と期限を出す静的サイト。
輸入利益チェッカー（yunyu-rieki）の姉妹サイト。

- `site/index.html` 画面（ビルドなし）、`site/calc.js` 計算（画面に依存しない純粋関数）
- テスト: `node --test tests/calc.test.js`（依存なし。国税庁パンフの計算例2つを答えに使う）
- 出典: 国税庁「飲食料品に係る2年間の消費税率引下げについて」（令和8年9月・法案成立前）
- 扱わないもの: 端数処理、簡易課税の75%ルール、インボイスの2割・3割特例、8%のまま残る定期便など
- 個別の税務相談にならないよう、結果は「目安」とし、最終判断は税理士・税務署へと出す

## 公開（Cloudflare Workers）

輸入利益チェッカーと同じ形。正式なURLは https://shohizei-check.com （2026-11-08 Cloudflare で購入）。

- `wrangler.jsonc` 設定。`site/` をそのまま配る。`routes` で独自ドメインと www をつなぐ
- `src/worker.js` www を正式なURLへ転送し、仮URL（`*.workers.dev`）に noindex を付ける
- `site/_headers` CSP など全ページ共通の守り。`site/robots.txt`・`site/sitemap.xml`
- 最初の1回だけ人の作業: Cloudflare の Workers & Pages で「Import a repository」からこのリポジトリを選ぶ
  （ビルドコマンドは空、デプロイコマンドは `npx wrangler deploy`）。以後は main への push で自動公開

