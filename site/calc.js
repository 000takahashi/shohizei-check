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

  function truthy(v) {
    return v === true || v === 1 || v === "1" || v === "true" || v === "yes";
  }

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
   *   invoice     インボイス発行事業者の登録をしている（true なら免税は選べない）
   *   specifiedOver 特定期間（前年の1〜6月など）の売上と給与がどちらも1,000万円を超えた
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
    // 免税は、2年前の売上が1,000万円以下で、特定期間も超えておらず、インボイスに登録していない時だけ。
    const canExempt = p.baseSales !== undefined && p.baseSales !== "" && base <= LIMIT.exempt
      && !truthy(p.invoice) && !truthy(p.specifiedOver);
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

  /**
   * 今（8%）と引下げ中（1%）を並べる。
   * p.share は、比べる課税期間のうち1%になる月の割合（0〜1、省略時 1）。
   * 令和9年4月1日を含む課税期間は、4月より前が8%のままなので、1年分の金額を月で按分して混ぜる。
   * （売上と仕入れが1年を通して同じ割合で出ると仮定した目安）
   */
  function compare(p) {
    const now = compute(Object.assign({}, p, { foodRate: RATE.foodNow }));
    const cut = compute(Object.assign({}, p, { foodRate: RATE.foodCut }));
    const share = p.share === undefined ? 1 : Math.min(1, Math.max(0, Number(p.share) || 0));
    const input = p.current && ["general", "simple", "exempt"].includes(p.current) ? p.current : "general";
    const pick = (r, k) => r.options.find((o) => o.key === k);
    // 今の方式が条件に合わない（2年前が1,000万円超なのに免税、5,000万円超なのに簡易など）時は、
    // 法律上は本則課税になるので、本則課税を「今」として比べる。
    const currentAllowed = pick(cut, input).allowed;
    const current = currentAllowed ? input : "general";
    const options = cut.options.map((o) => Object.assign({}, o, {
      tax: share * o.tax + (1 - share) * pick(now, o.key).tax,
    }));
    const allowed = options.filter((o) => o.allowed);
    const best = allowed.reduce((a, b) => (b.tax < a.tax ? b : a));
    const nowTax = pick(now, current).tax;
    const stayTax = options.find((o) => o.key === current).tax;
    return {
      now, cut, current, currentInput: input, currentAllowed, share, options, best,
      nowTax,                     // 今の方式で、今の税率（1年）
      stayTax,                    // 今の方式のまま、比べる課税期間
      bestTax: best.tax,          // 比べる課税期間に一番少ない方式
      bestKey: best.key,
      changeIfStay: stayTax - nowTax,
      saveBySwitch: stayTax - best.tax,
      shouldSwitch: best.key !== current && stayTax - best.tax >= 1,
      notes: (currentAllowed ? [] : [input === "exempt"
        ? "現在の条件では免税事業者になれません（2年前や前年前半の売上、インボイスの登録によります）。課税事業者として、本則課税を現在の方式とみなして比較しております。"
        : "2年前の課税売上高が5,000万円を超えているため、簡易課税はご利用になれません。本則課税を現在の方式とみなして比較しております。"]).concat(notesFor({ s: { food: num(p.foodSales), eatIn: num(p.eatIn) },
        general: options.find((o) => o.key === "general").tax, canExempt: cut.canExempt, best })),
      full: { bestKey: cut.best.key, bestTax: cut.best.tax, stayTax: pick(cut, current).tax }, // 丸1年が1%の時
    };
  }

  /** 課税期間のうち、1%の期間（令和9年4月〜令和11年3月）に入る月の数。 */
  function cutMonths(start, end) {
    let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
    const ey = Number(end.slice(0, 4)), em = Number(end.slice(5, 7));
    let n = 0;
    while (y < ey || (y === ey && m <= em)) {
      const ym = y * 100 + m;
      if (ym >= 202704 && ym <= 202903) n++;
      m++; if (m > 12) { m = 1; y++; }
    }
    return n;
  }

  function notesFor({ s, general, simple, canExempt, best }) {
    const n = [];
    if (general < 0) n.push("本則課税であれば還付（納めた税金が戻ること）となります。還付を受けるには、本則課税で申告していただく必要がございます。");
    if (best.key === "exempt") n.push("免税のままでも納税はございません。ただし、取引先が仕入れの税を控除できなくなるため、取引先が事業者の場合は値下げを求められることがございます。");
    if (canExempt && general < 0) n.push(s.food > 0
      ? "免税事業者の方も、課税事業者を選択すれば還付を受けられます（飲食料品を販売されているため、特例により令和9年4月1日を含む期間の中に届出をご提出いただけます）。"
      : "免税事業者の方も、課税事業者を選択すれば還付を受けられます（届出の期限は、その課税期間が始まる前日までです）。");
    if (s.eatIn > 0 && s.food > 0) n.push("店内飲食（10%）と持ち帰り（1%）の差が9%に広がります。値付けやレジの設定も、この機会に見直されることをおすすめいたします。");
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
   * @param {boolean} sellsFood 飲食料品の販売をしているか。届出の特例は販売している事業者だけ（省略時 true）。
   */
  function steps(current, best, who, endMonth, sellsFood) {
    const pr = period(who, endMonth);
    const food = sellsFood === undefined ? true : !!sellsFood;
    const before = new Date(Date.parse(pr.start + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    const noFood = "飲食料品の販売がないため、今回の特例はご利用になれません。変更したい課税期間が始まる前日までにご提出ください。";
    if (current === best) {
      return { need: false, text: "現在の申告方式のままで、届出は不要です。", period: pr };
    }
    if (best === "general" && current === "simple" && !food) {
      return { need: true, form: "簡易課税制度選択不適用届出書", deadline: before, special: false, period: pr, text: noFood };
    }
    if (best === "general" && current === "exempt" && !food) {
      return { need: true, form: "課税事業者選択届出書", deadline: before, special: false, period: pr, text: noFood };
    }
    if (best === "general" && current === "simple") {
      return { need: true, form: "簡易課税制度選択不適用届出書", deadline: pr.deadline, special: true, period: pr,
        text: "特例により、令和9年4月1日を含む課税期間の中にご提出いただければ、その期間から本則課税となります。簡易課税の2年間の継続義務もかかりません。" };
    }
    if (best === "general" && current === "exempt") {
      return { need: true, form: "課税事業者選択届出書", deadline: pr.deadline, special: true, period: pr,
        text: "特例により、令和9年4月1日を含む課税期間の中にご提出いただければ、その期間から課税事業者となります。原則として2年間は課税事業者のままとなります。" };
    }
    if (best === "simple") {
      return { need: true, form: "簡易課税制度選択届出書", deadline: before, special: false, period: pr,
        text: "簡易課税には今回の特例がございません。適用を受けたい課税期間が始まる前日までにご提出ください。原則として2年間は継続していただく必要がございます。" };
    }
    return { need: true, form: null, deadline: null, special: false, period: pr,
      text: "免税事業者に戻る届出は、課税事業者になった理由で異なります。「課税事業者選択届出書」を出している場合は、課税事業者選択不適用届出書を戻りたい課税期間が始まる前日までに（選んでから2年間は出せません）。売上が1,000万円を超えていたために課税事業者になっている場合は、基準期間と特定期間の売上が1,000万円以下になれば届出なしで免税となり、「消費税の納税義務者でなくなった旨の届出書」を速やかに提出します。インボイスの登録を受けている場合は、登録の取消しも必要です。" };
  }

  function lastDay(y, m) {
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }

  return { RATE, KUBUN, LIMIT, PRESETS, CUT_START, CUT_END, PRICE_DISPLAY, compute, compare, period, steps, cutMonths };
});
