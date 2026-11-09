# Google と Bing に登録する手順

サイトがあることを検索会社に伝え、どんな言葉で何回表示されたかを見られるようにします。
どちらも無料です。本人のアカウントでの操作が要るので、ここだけは人の手で行います。所要時間は合わせて15分ほどです。
（輸入利益チェッカーの `docs/search-registration.md` と同じ手順です。）

## 1. Google Search Console

1. https://search.google.com/search-console を開き、Google アカウントでログインする。
2. 左上のサイト名の一覧から「プロパティを追加」を選び、**ドメイン** に `shohizei-check.com` と入れる。
3. 所有権の確認。Cloudflare で管理しているドメインなら、Google が「Cloudflare で確認」を出すので、それを押して Cloudflare にログインすれば自動で済みます（2026-11-09 確認）。
   - 出ない時だけ手で行う：画面の「TXT レコード」（`google-site-verification=…`）をコピーし、Cloudflare の `shohizei-check.com` → **DNS** → **レコードを追加**（タイプ: TXT／名前: `@`／内容: コピーした文字）→ Search Console で「確認」。
4. 左の **サイトマップ** を開き、`https://shohizei-check.com/sitemap.xml` と**住所を全部**入れて送信する（「ドメイン」で登録した時は `sitemap.xml` だけだと「サイトマップ アドレスが無効です」になる）。
5. 左の **URL検査** で `https://shohizei-check.com/` を入れ、「インデックス登録をリクエスト」を押す。

## 2. Bing Webmaster Tools（Bing・Yahoo! の一部・ChatGPT の検索に効きます）

1. https://www.bing.com/webmasters を開き、ログインする。
2. 「Google Search Console からインポート」を選び、`shohizei-check.com` にチェックを入れて取り込む（確認の手続きは不要）。

## 登録した後に見るところ

- 1〜2週間後に、Search Console の **検索パフォーマンス** →「クエリ」で、実際に検索された言葉を見る。
- 表示はあるのにクリックが少ない言葉があれば、題名や説明文を直す材料になります。

## 画面の「よくある質問」を変えた時

`node scripts/seo-sync.js` を実行すると、検索向けの構造化データ（JSON-LD）が同じ内容に作り直されます。
忘れてもテスト（`tests/seo.test.js`）が落ちて知らせます。
