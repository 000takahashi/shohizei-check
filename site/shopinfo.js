// 消費税1%チェッカーの有料パスの値段・中身と、販売者の表示（特定商取引法）。画面とサーバーが同じこのファイルを読む。
// ★ OPERATOR.contact が空の間は、サーバーも画面も売り出さない（もう1つの扉は Cloudflare の鍵）。
//   連絡先は、届いて返信できる物だけを入れる。決めるのは運営者だけ。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShopInfo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // 売っているパス。値段と日数はここだけ。画面・支払い・表記が同じ数字になる。値段を決めるのは運営者だけ
  var PRODUCT = 'shohizei-pass';
  var PLANS = [
    { id: 'd7', days: 7, yen: 300 },
    { id: 'd30', days: 30, yen: 980 },
  ];
  // 無料開放の期間。この日（日本時間）の終わりまで、有料の機能をパスなしで使える。その間はパスを売らない。
  // 期間を決めるのは運営者だけ。空（''）にすると、無料開放なし
  var FREE_UNTIL = '2026-11-30';
  function freeOpen(nowMs) {
    if (!FREE_UNTIL) return false;
    var today = new Date((nowMs || Date.now()) + 9 * 3600 * 1000).toISOString().slice(0, 10);
    return today <= FREE_UNTIL;
  }
  function freeText() { var m = /^(\d+)-(\d+)-(\d+)$/.exec(FREE_UNTIL); return m ? Number(m[2]) + '月' + Number(m[3]) + '日' : ''; }
  function planById(id) { for (var i = 0; i < PLANS.length; i++) if (PLANS[i].id === id) return PLANS[i]; return null; }
  // 短いパスから長いパスへの切り替え。払うのは差額だけ。期限は、最初のお支払いから数えた長いパスの日数になる
  function upgradeFrom(fromId) {
    var from = planById(fromId), to = PLANS[PLANS.length - 1];
    if (!from || from.id === to.id || to.days <= from.days || to.yen <= from.yen) return null;
    return { from: from, to: to, yen: to.yen - from.yen, addDays: to.days - from.days };
  }
  // パスの印の中の、パスの名前（v1.<期限>.<名前>-<ID>.<署名>）
  function planOfToken(token) { var m = /^v1\.\d{1,12}\.(d\d{1,3})-/.exec(token || ''); return m && planById(m[1]) ? m[1] : ''; }
  function upgradeText() {
    var out = [];
    PLANS.forEach(function (p) { var u = upgradeFrom(p.id); if (u) out.push(u.from.days + '日間のパスの有効期間中は、差額の' + u.yen.toLocaleString('ja-JP') + '円（税込）で' + u.to.days + '日間に切り替えられます。有効期限は、最初のお支払いの時点から' + u.to.days + '日間となります。'); });
    return out.join('');
  }
  function planText(p) { return p.days + '日間 ' + p.yen.toLocaleString('ja-JP') + '円（税込）'; }
  // name: 本名（空なら「請求があれば遅滞なく開示」と表示）。tradeName: 屋号。contact: 返信できるメールアドレス。
  // 運営者・連絡先は、このサイトの「運営者情報」に前から出している物と同じ。
  // 2026-11-12 運営者（高橋さん）が、チェッカーごとのアドレスはどれも受信できていると確かめた。
  var OPERATOR = { name: '', tradeName: '輸入利益チェッカー 編集室', contact: 'contact@shohizei-check.com' };
  var FEATURES = [
    '1%が始まる年から終わった後の年までを通して、どの申告方式が最も少なくなるかをお示しいたします。',
    '申告方式を変更した際の「2年間は継続する決まり」を踏まえ、ご提出いただく届出と期限を順番にお示しいたします。期限はカレンダーに登録できます。',
    '年ごとの納税の見込みと、毎月取り置く金額の目安をお示しいたします。税理士の先生にお見せいただけるよう、印刷とCSVでの保存（Excel・Google スプレッドシート）にも対応しております。',
    '持ち帰りと店内の価格をご入力いただくと、1%になった時の値付けの案をお示しいたします。',
    'パスの期間中は、広告を表示いたしません。',
  ];
  function hasOperator(op) { return !!String((op || OPERATOR).contact || '').trim(); }
  var ON_REQUEST = 'ご請求があれば、遅滞なく開示いたします。メールにてご請求ください。';
  // 特定商取引法に基づく表記の行。販売者の表示が無い間は空（＝ページを出さない）
  function legalRows(op) {
    op = op || OPERATOR;
    if (!hasOperator(op)) return [];
    var name = String(op.name || '').trim(), trade = String(op.tradeName || '').trim();
    var rows = [['販売事業者', name || '個人事業者でございます。氏名は、ご請求があれば、遅滞なく開示いたします。']];
    if (trade) rows.push(['屋号', trade]);
    rows.push(
      ['運営責任者', name || '販売事業者と同一でございます（氏名は、ご請求があれば、遅滞なく開示いたします）。'],
      ['所在地', ON_REQUEST],
      ['電話番号', ON_REQUEST],
      ['メールアドレス', String(op.contact).trim()],
      ['販売価格', '有料パス ' + PLANS.map(planText).join('、') + (upgradeText() ? '。' + upgradeText() : '')],
      ['商品代金以外の必要料金', 'インターネットの通信料は、お客様のご負担となります。'],
      ['内容', FEATURES.join(' ') + ' 計算の結果は目安であり、実際の税額は申告によって確定いたします。法案の成立を前提としております。'],
      ['支払方法', 'クレジットカード・デビットカード（Stripe のお支払い画面にて承ります）'],
      ['支払時期', 'ご購入時（その場で確定いたします）'],
      ['提供時期', 'お支払いが完了次第、すぐにご利用いただけます。ご利用期間は、お支払いの時点から、ご購入いただいたパスの日数（' + PLANS.map(function (p) { return p.days + '日間'; }).join('か') + '）です。自動で更新されません。'],
      ['返品・キャンセル', 'デジタルサービスの性質上、お支払い後のキャンセル・返金はお受けいたしかねます。途中でご利用をおやめになった場合も、日割りでの返金はございません。当方の不具合によりパスをご利用いただけなかった場合は、全額を返金いたします。メールにてご連絡ください。'],
      ['動作環境', '最新版の Safari や Chrome などでご利用ください。パスはこの端末に保存されるため、ブラウザのデータを消去されますとパスも消去されます。']
    );
    return rows;
  }
  function legalNote(op) {
    return String((op || OPERATOR).name || '').trim()
      ? '販売事業者の所在地と電話番号は、ご請求をいただければ、これらを記載したメールを遅滞なくお送りいたします。ご請求は、下記のメールアドレスまでお送りください。'
      : '販売事業者の氏名、所在地、電話番号は、ご請求をいただければ、これらを記載したメールを遅滞なくお送りいたします。ご請求は、下記のメールアドレスまでお送りください。';
  }
  return { PRODUCT: PRODUCT, PLANS: PLANS, planById: planById, planText: planText, FREE_UNTIL: FREE_UNTIL, freeOpen: freeOpen, freeText: freeText, upgradeFrom: upgradeFrom, planOfToken: planOfToken, upgradeText: upgradeText, OPERATOR: OPERATOR, FEATURES: FEATURES, hasOperator: hasOperator, legalRows: legalRows, legalNote: legalNote };
});
