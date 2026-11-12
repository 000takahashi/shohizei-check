# 消費税1%チェッカー

令和9年4月〜令和11年3月の食料品の消費税1%に合わせて、飲食店と食品の仕入れ先が
本則課税・簡易課税・免税のどれが得かを試算し、届出と期限を出す静的サイト。
輸入利益チェッカー（yunyu-rieki）の姉妹サイト。

- `site/index.html` 画面（ビルドなし）、`site/calc.js` 計算（画面に依存しない純粋関数）
- テスト: `node --test tests/calc.test.js tests/seo.test.js tests/csv.test.js tests/ics.test.js tests/year.test.js tests/plancsv.test.js tests/paid.test.mjs tests/pass.test.mjs tests/ads.test.mjs`（依存なし。国税庁パンフの計算例2つを答えに使う）
- 出典: 国税庁「飲食料品に係る2年間の消費税率引下げについて」（令和8年9月）。法案は令和8年11月6日に衆議院で可決、参議院で審議中（未成立）
- 扱わないもの: 端数処理、簡易課税の75%ルール、インボイスの2割・3割特例、8%のまま残る定期便など
- 個別の税務相談にならないよう、結果は「目安」とし、最終判断は税理士・税務署へと出す

## 有料の機能（パス）

今までの試算・届出と期限・CSVの読み込みは無料のまま。有料は次の2画面で、計算はサーバー（`functions/`）でする。入力も結果も保存しない。AIは使わない。

- `#plan` 2年間の通しの見通し（`POST /api/v1/plan`・`functions/_lib/plan.mjs`）。1%が始まる期間から、1%の月が無くなる最初の期間までを並べ、「簡易課税と課税事業者の選択は2期間続ける」「期限が過ぎた届出は出せない」を守った道の中で、合計が一番少ない道・届出と期限・毎月の取り置きを出す
- `#price` 持ち帰り・店内の値付け（`POST /api/v1/pricing`・`functions/_lib/pricing.mjs`）
- パスが無い人には、見本の数字での結果（`{ sample: true }`）と、自分の数字での差額だけ（402 の `teaser`）を返す。道・届出・値段の表は返さない（`tests/paid.test.mjs` が固定）
- 画面は `site/planui.js`・`site/passui.js`。値段・パスの中身・販売者の表示は `site/shopinfo.js` の1か所（画面・支払い・特定商取引法の表記が同じ数字になる）
- 無料と有料の線、値段を変えるのは運営者だけ

### 売り出す（Stripe）

輸入利益チェッカーと同じ作り（Stripe Checkout・登録なし・データベースなし・Webhookなし）。`GET /api/v1/pass/status`・`POST /api/v1/pass/checkout`・`POST /api/v1/pass/claim`。

無料開放：`site/shopinfo.js` の `FREE_UNTIL`（いまは 2026-11-30）の日の終わり（日本時間）まで、有料の機能をパスなしで通す。その間はパスを売らない（`checkout` は 503）。次の日から自動で有料に戻る。期間を決めるのは運営者だけ。

7日間のパスが使える間は、差額（30日間の値段から7日間の値段を引いた額）で30日間に切り替えられる。`POST /api/v1/pass/checkout` に `{ plan, upgrade: true }` といまのパス（`Authorization: Bearer`）を送る。期限は、最初のお支払いから30日間。パスの印には、パスの名前（`d7`・`d30`）が入る。決まりは `site/shopinfo.js` の `upgradeFrom`。

売り出しの扉は2つ。両方そろうまで、画面は「準備中」、サーバーは 503 を返す。

1. `site/shopinfo.js` の `OPERATOR.contact`（届いて返信できる連絡先。入れてある）
2. Cloudflare の Worker の Secret に `STRIPE_SECRET_KEY` と `PASS_SIGNING_SECRET`（運営者が自分で入れる。リポジトリにも会話にも書かない）

手元で有料の画面を試す時は `npx wrangler dev --port 8792 --var PAID_OPEN:1`（本番には入れない）。

## 減税が終わっても使えるようにする物

- `#year` 8%の年の申告方式（無料・`site/yearkit.js`・`site/yearui.js`）。食料品8%の1年分で方式を比べ、次の課税期間の届出の期限を出す。1%が終わったあとも毎年使える
- 届出の期限をカレンダーに入れる（`site/icskit.js`。ファイルは端末で作り、どこにも送らない）

## 帳簿から読み込む（CSV）

画面の「帳簿から読み込む（CSV）」（`#bulk`）で、会計ソフトの取引・仕訳のCSVから、8%と10%の売上・仕入れを1年分（税抜き）に集めて試算の欄に入れます。
ファイルはブラウザの中だけで読み、サーバーにもAIにも送りません（通信なし・保存なし）。

- `site/csvkit.js`・`site/csvui.js`・`site/csvkit.css` 読み込みの道具と画面の部品。輸入利益チェッカー・免税チェッカーと同じファイル（直す時は3つそろえる）
- `site/bulk.js` 税区分の読み方（freee の1列型、マネーフォワード・弥生の借方・貸方型）と集計。テストは `tests/csv.test.js`
- 形の違う明細は、お客様のAIに整えてもらうお願い文（`AI_PROMPT`）を画面に出している

## 公開（Cloudflare Workers）

輸入利益チェッカーと同じ形。正式なURLは https://shohizei-check.com （2026-11-08 Cloudflare で購入）。

- `wrangler.jsonc` 設定。`site/` をそのまま配る。`routes` で独自ドメインと www をつなぐ
- `src/worker.js` `/api/v1/*` を `functions/` へ渡し、www を正式なURLへ転送し、仮URL（`*.workers.dev`）に noindex を付ける
- `site/_headers` CSP など全ページ共通の守り。`site/robots.txt`・`site/sitemap.xml`・`site/llms.txt`（AI 向けの説明）
- 検索向けの構造化データ（JSON-LD）は画面の「よくある質問」から `node scripts/seo-sync.js` で作る。Google・Bing への登録手順は `docs/search-registration.md`
- 最初の1回だけ人の作業: Cloudflare の Workers & Pages で「Import a repository」からこのリポジトリを選ぶ
  （ビルドコマンドは空、デプロイコマンドは `npx wrangler deploy`）。以後は main への push で自動公開

## 印刷とCSVの書き出し

- 印刷は全画面で無料。`site/print.css`・`site/print.js` は輸入利益チェッカー・免税チェッカーと同じファイル（直す時は3つそろえる）。いま開いている画面だけを、メニューとボタンを外して出し、紙の上に「どのサイトで・いつ作ったか・結果は目安」の1行を入れる。ボタンは `data-print` を付けるだけ。`details[data-print-open]` は紙では開いて出す
- CSVの書き出しは有料の画面だけ（`#plan` の見通し＝`site/plancsv.js`・`tests/plancsv.test.js`、`#price` の値付け）。どれもこの端末で作り、どこにも送らない。BOM 付き UTF-8 なので Excel と Google スプレッドシートでそのまま開ける


## 広告（Google アドセンス）

- `site/adsui.js` が広告の読み込みを決める（3つのチェッカーで同じファイル。直す時は3つそろえる。テストは `tests/ads.test.mjs`）。有料パスが使える間は、広告のスクリプトを読み込まない（広告も Cookie も出さない）。パスを受け取った直後は `AdsUI.hideAll()` で枠を閉じる。
- ページに `adsbygoogle.js` の `<script>` を直接書かない（パスの人にも読み込まれてしまう）。サイトの確認は `<meta name="google-adsense-account">` と `site/ads.txt` で行う
- 広告の場所は `<aside class="adslot" data-ad-slot="">` の2つ（試算・計算の結果の下と、ページの下）。アドセンスで作った広告ユニットの番号を `data-ad-slot` に入れると出る。空の枠は出さない
- 場所の確認は `?ads=preview`（点線の枠だけ出る。広告は読み込まない）
- 自動広告をオンにする場合は、画面の下に張り付く広告と全画面の広告（アンカー・モバイル全画面）はオフにする（入力の邪魔になるため）
