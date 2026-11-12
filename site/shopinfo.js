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
    { id: 'd30', days: 30, yen: 1480 },
  ];
  function planById(id) { for (var i = 0; i < PLANS.length; i++) if (PLANS[i].id === id) return PLANS[i]; return null; }
  function planText(p) { return p.days + '日間 ' + p.yen.toLocaleString('ja-JP') + '円（税込）'; }
  // name: 本名（空なら「請求があれば遅滞なく開示」と表示）。tradeName: 屋号。contact: 返信できるメールアドレス。
  // 運営者・連絡先は、このサイトの「運営者情報」に前から出している物と同じ。
  // 2026-11-12 運営者（高橋さん）が、チェッカーごとのアドレスはどれも受信できていると確かめた。
  var OPERATOR = { name: '', tradeName: '輸入利益チェッカー 編集室', contact: 'contact@shohizei-check.com' };
  var FEATURES = [
    '1%が始まる年から終わったあとの年までを通して、どの方式が一番少ないかを出します。',
    '方式を変えた時の「2年は続ける決まり」を入れて、出す届出と期限を順番に並べます。',
    '年ごとの納税の見込みと、毎月取り置く額の目安を出します。税理士に見せる用に印刷できます。',
    '持ち帰りと店内の値段を入れると、1%になった時の値付けの案を出します。',
  ];
  function hasOperator(op) { return !!String((op || OPERATOR).contact || '').trim(); }
  var ON_REQUEST = '請求があれば、遅滞なく開示します。メールでご請求ください。';
  // 特定商取引法に基づく表記の行。販売者の表示が無い間は空（＝ページを出さない）
  function legalRows(op) {
    op = op || OPERATOR;
    if (!hasOperator(op)) return [];
    var name = String(op.name || '').trim(), trade = String(op.tradeName || '').trim();
    var rows = [['販売事業者', name || '個人事業者です。氏名は、請求があれば、遅滞なく開示します。']];
    if (trade) rows.push(['屋号', trade]);
    rows.push(
      ['運営責任者', name || '販売事業者と同じです（氏名は、請求があれば、遅滞なく開示します）。'],
      ['所在地', ON_REQUEST],
      ['電話番号', ON_REQUEST],
      ['メールアドレス', String(op.contact).trim()],
      ['販売価格', '有料パス ' + PLANS.map(planText).join('、')],
      ['商品代金以外の必要料金', 'インターネットの通信料は、お客様のご負担です。'],
      ['内容', FEATURES.join(' ') + ' 計算の結果は目安で、実際の税額は申告で決まります。法案が成立することが前提です。'],
      ['支払方法', 'クレジットカード・デビットカード（Stripe の支払い画面で）'],
      ['支払時期', 'ご購入の時（その場で確定します）'],
      ['提供時期', 'お支払いが済むと、すぐに使えます。お支払いの時から、買ったパスの日数（' + PLANS.map(function (p) { return p.days + '日間'; }).join('か') + '）です。自動で更新されません。'],
      ['返品・キャンセル', 'デジタルのサービスのため、お支払いの後のキャンセル・返金はできません。途中でやめた場合も、日割りの返金はありません。当方の不具合でパスが使えなかった場合は、全額を返金します。メールでご連絡ください。'],
      ['動作環境', '新しい版の Safari や Chrome など。パスはこの端末に保存されるため、ブラウザのデータを消すとパスも消えます。']
    );
    return rows;
  }
  function legalNote(op) {
    return String((op || OPERATOR).name || '').trim()
      ? '販売事業者の所在地と電話番号は、ご請求があれば、これらを記したメールを遅滞なくお送りします。ご請求は、下記のメールアドレスへお送りください。'
      : '販売事業者の氏名、所在地、電話番号は、ご請求があれば、これらを記したメールを遅滞なくお送りします。ご請求は、下記のメールアドレスへお送りください。';
  }
  return { PRODUCT: PRODUCT, PLANS: PLANS, planById: planById, planText: planText, OPERATOR: OPERATOR, FEATURES: FEATURES, hasOperator: hasOperator, legalRows: legalRows, legalNote: legalNote };
});
