/*
 * 食料品の消費税1% 試算（計算だけ・画面に依存しない）
 *
 * 出典: 国税庁「飲食料品に係る2年間の消費税率引下げについて」（令和8年9月）。
 * 大綱（令和8年9月15日閣議決定）にもとづく案で、法案は成立前。
 *
 * 金額はすべて「税抜き・1年分」。税は国と地方を合わせた率で計算する目安。
 * 端数処理、75%ルール、インボイスの2割・3割特例、経過措置の8%取引は扱わない。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Shokuhin = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RATE = { std: 0.10, foodNow: 0.08, foodCut: 0.01 };
  const CUT_START = "2027-04-01"; // 令和9年4月1日
  const CUT_END = "2029-03-31";   // 令和11年3月31日
  const PRICE_DISPLAY = { from: "2027-02-01", to: "2027-05-31" }; // 総額表示の特例

  // 簡易課税のみなし仕入率（事業区分）
  const KUBUN = {
    1: { name: "第1種（卸売）", rate: 0.9 },
    2: { name: "第2種（小売）", rate: 0.8 },
    3: { name: "第3種（製造・持ち帰りの調理品など）", rate: 0.7 },
    4: { name: "第4種（飲食店の店内飲食など）", rate: 0.6 },
    5: { name: "第5種（サービス業など）", rate: 0.5 },
    6: { name: "第6種（不動産業）", rate: 0.4 },
  };

  const LIMIT = { exempt: 10_000_000, simple: 50_000_000 };

  // 業種ごとの初期値（画面の「おすすめの区分」）
  const PRESETS = {
    restaurant: { label: "飲食店（店内飲食が中心）", foodKubun: 3, otherKubun: 4 },
    takeout: { label: "持ち帰り・弁当・惣菜", foodKubun: 3, otherKubun: 4 },
    wholesale: { label: "食品の卸（仕入れ先）", foodKubun: 1, otherKubun: 1 },
    retail: { label: "食品の小売（スーパー・商店）", foodKubun: 2, otherKubun: 2 },
    maker: { label: "食品の製造・加工", foodKubun: 3, otherKubun: 3 },
  };

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * 1年分の税額を、本則・簡易・免税で比べる。
   * @param {object} p
   *   eatIn       店内飲食・ケータリングの売上（10%のまま）
   *   foodSales   飲食料品の販売（持ち帰り・出前・卸・小売。8%→1%）
   *   otherSales  その他の売上（酒・雑貨など10%）
   *   foodBuy     飲食料品の仕入れ（8%→1%）
   *   otherBuy    10%の仕入れ・経費（酒、消耗品、家賃、光熱費、設備など）
   *   foodKubun / eatInKubun / otherKubun  簡易課税の区分（1〜6）
   *   baseSales   基準期間（2年前）の課税売上高
   *   foodRate    飲食料品の税率（省略時 1%）
   */
  function compute(p) {
    const s = {
      eatIn: num(p.eatIn), food: num(p.foodSales), other: num(p.otherSales),
      foodBuy: num(p.foodBuy), otherBuy: num(p.otherBuy),
    };
    const fr = p.foodRate === undefined ? RATE.foodCut : p.foodRate;
    const kFood = KUBUN[p.foodKubun] ? p.foodKubun : 2;
    const kEat = KUBUN[p.eatInKubun] ? p.eatInKubun : 4;
    const kOther = KUBUN[p.otherKubun] ? p.otherKubun : 2;

    const salesTax = {
      eatIn: s.eatIn * RATE.std,
      food: s.food * fr,
      other: s.other * RATE.std,
    };
    const salesTaxTotal = salesTax.eatIn + salesTax.food + salesTax.other;
    const buyTax = s.foodBuy * fr + s.otherBuy * RATE.std;

    // 本則（一般課税）: 売上の税 − 仕入れの税。マイナスは還付。
    const general = salesTaxTotal - buyTax;

    // 簡易課税: 1%の飲食料品の売上の税は、同じ額を仕入れの税として引く（特例）。
    // 8%の時は通常どおり、区分のみなし仕入率をかける。
    const cutRule = fr === RATE.foodCut;
    const deductFood = cutRule ? salesTax.food : salesTax.food * KUBUN[kFood].rate;
    const deduct = deductFood
      + salesTax.eatIn * KUBUN[kEat].rate
      + salesTax.other * KUBUN[kOther].rate;
    const simple = Math.max(0, salesTaxTotal - deduct);

    const base = num(p.baseSales);
    const canExempt = p.baseSales !== undefined && p.baseSales !== "" && base <= LIMIT.exempt;
    const canSimple = !(p.baseSales !== undefined && p.baseSales !== "" && base > LIMIT.simple);

    const options = [
      { key: "general", label: "本則課税（一般課税）", tax: general, allowed: true },
      { key: "simple", label: "簡易課税", tax: simple, allowed: canSimple },
      { key: "exempt", label: "免税事業者", tax: 0, allowed: canExempt },
    ];
    const allowed = options.filter((o) => o.allowed);
    const best = allowed.reduce((a, b) => (b.tax < a.tax ? b : a));

    return {
      salesTax, salesTaxTotal, buyTax, deduct, general, simple,
      options, best, canExempt, canSimple, foodRate: fr,
      notes: notesFor({ s, general, simple, canExempt, best }),
    };
  }

  /** 今（8%）と引下げ中（1%）を並べる。 */
  function compare(p) {
    const now = compute(Object.assign({}, p, { foodRate: RATE.foodNow }));
    const cut = compute(Object.assign({}, p, { foodRate: RATE.foodCut }));
    const current = p.current && ["general", "simple", "exempt"].includes(p.current) ? p.current : "general";
    const pick = (r, k) => r.options.find((o) => o.key === k);
    const nowTax = pick(now, current).tax;
    const stayTax = pick(cut, current).tax;
    return {
      now, cut, current,
      nowTax,                     // 今の方式で、今の税率
      stayTax,                    // 今の方式のまま、1%の期間
      bestTax: cut.best.tax,      // 1%の期間に一番少ない方式
      bestKey: cut.best.key,
      changeIfStay: stayTax - nowTax,
      saveBySwitch: stayTax - cut.best.tax,
      shouldSwitch: cut.best.key !== current && stayTax - cut.best.tax >= 1,
    };
  }

  function notesFor({ s, general, simple, canExempt, best }) {
    const n = [];
    if (general < 0) n.push("本則課税なら還付（税金が戻る）になります。還付を受けるには本則課税で申告します。");
    if (best.key === "exempt") n.push("免税のままでも納税はありません。ただし取引先が仕入れの税を引けなくなるため、取引先が事業者の場合は値下げを求められることがあります。");
    if (canExempt && general < 0) n.push("免税事業者でも、課税事業者を選べば還付を受けられます（特例で、令和9年4月1日を含む期間の中に届出を出せます）。");
    if (s.eatIn > 0 && s.food > 0) n.push("店内飲食（10%）と持ち帰り（1%）の差が9%に広がります。値付けとレジの設定を見直す時期です。");
    return n;
  }

  /**
   * 令和9年4月1日を含む課税期間と、特例の届出の期限。
   * @param {"individual"|"corporate"} who
   * @param {number} endMonth 法人の決算月（1〜12）
   */
  function period(who, endMonth) {
    if (who !== "corporate") {
      return { start: "2027-01-01", end: "2027-12-31", deadline: "2027-12-31" };
    }
    const m = Math.min(12, Math.max(1, Math.floor(Number(endMonth) || 3)));
    // 2027-04-01 を含む1年の事業年度: 終わりは 2027-04 以降で最初の m 月末
    const endYear = m >= 4 ? 2027 : 2028;
    const end = lastDay(endYear, m);
    const startDate = new Date(Date.UTC(endYear - 1, m, 1)); // 翌月1日の1年前
    const start = startDate.toISOString().slice(0, 10);
    return { start, end, deadline: end };
  }

  /**
   * 今の方式から一番少ない方式へ移る時に要る届出と期限（目安）。
   * 期限は「令和9年4月1日を含む課税期間」から移る場合。
   */
  function steps(current, best, who, endMonth) {
    const pr = period(who, endMonth);
    if (current === best) {
      return { need: false, text: "今の申告のしかたのままで、届出はいりません。", period: pr };
    }
    if (best === "general" && current === "simple") {
      return { need: true, form: "簡易課税制度選択不適用届出書", deadline: pr.deadline, special: true, period: pr,
        text: "特例で、令和9年4月1日を含む課税期間の中に出せば、その期間から本則課税になります。簡易課税の2年縛りもかかりません。" };
    }
    if (best === "general" && current === "exempt") {
      return { need: true, form: "課税事業者選択届出書", deadline: pr.deadline, special: true, period: pr,
        text: "特例で、令和9年4月1日を含む課税期間の中に出せば、その期間から課税事業者になれます。原則2年は課税事業者のままです。" };
    }
    if (best === "simple") {
      const before = new Date(Date.parse(pr.start + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      return { need: true, form: "簡易課税制度選択届出書", deadline: before, special: false, period: pr,
        text: "簡易課税には今回の特例がありません。適用したい課税期間が始まる前の日までに出します。原則2年は続けます。" };
    }
    return { need: true, form: null, deadline: null, special: false, period: pr,
      text: "免税事業者に戻れるかは、2年前の売上やインボイスの登録で決まります。税理士に確かめてください。" };
  }

  function lastDay(y, m) {
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }

  return { RATE, KUBUN, LIMIT, PRESETS, CUT_START, CUT_END, PRICE_DISPLAY, compute, compare, period, steps };
});
