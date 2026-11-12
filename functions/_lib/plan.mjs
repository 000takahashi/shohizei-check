// 2年間の通しの見通し（有料）。計算だけ・保存しない・AIは使わない。
//
// 無料の試算は「令和9年4月1日を含む課税期間」の1つだけを比べる。
// ここでは、1%が始まる期間から、1%が終わったあとの最初の期間までを並べ、
// 方式を変えた時の「2年は続ける決まり」と届出の期限を守った上で、通しで一番少ない道を出す。
//
// 前提（画面にも出す）:
// - 売上と仕入れは毎年同じ。2年前の売上の判定（1,000万円・5,000万円）も毎年同じ。
// - 課税期間は1年。各期間は、1%の月と8%の月を月数で按分する（無料の試算と同じ）。
// - 簡易課税を新しく選ぶと、2つの課税期間は続ける。免税から課税事業者を選んだ時も同じ。
// - 特例（期間の中に出せる届出）は、令和9年4月1日を含む期間に、飲食料品を売っている事業者が
//   「簡易→本則」「免税→課税」へ移る時だけ。簡易→本則の特例には、2年続ける決まりがかからない。
// - 高額な設備を買った時の3年しばり、インボイスの2割・3割特例、75%ルール、端数は入れない。
import S from '../../site/calc.js';

export const PLAN_LIMIT = { amount: 1e12 };
const KEYS = ['general', 'simple', 'exempt'];
const LABEL = { general: '本則課税', simple: '簡易課税', exempt: '免税事業者' };

const iso = (d) => d.toISOString().slice(0, 10);
const dayBefore = (s) => iso(new Date(Date.parse(s + 'T00:00:00Z') - 86400000));
const dayAfter = (s) => iso(new Date(Date.parse(s + 'T00:00:00Z') + 86400000));
function yearEndFrom(start) { // start の1年後の前日
  const d = new Date(start + 'T00:00:00Z');
  return dayBefore(iso(new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()))));
}

/** 1%が始まる期間から、1%の月が無くなる最初の期間まで（最大5つ）。 */
export function periods(who, endMonth) {
  const out = [];
  let p = S.period(who === 'corporate' ? 'corporate' : 'individual', endMonth);
  let start = p.start, end = p.end;
  for (let i = 0; i < 5; i++) {
    const cut = S.cutMonths(start, end);
    out.push({ start, end, cutMonths: cut, share: cut / 12 });
    if (cut === 0) break;
    start = dayAfter(end);
    end = yearEndFrom(start);
  }
  return out;
}

function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(n, PLAN_LIMIT.amount) : 0; }

/** 入力を数字にそろえる。おかしな形は { error }。 */
export function cleanPlan(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'bad_input' };
  const base = b.baseSales === '' || b.baseSales === undefined || b.baseSales === null ? '' : num(b.baseSales);
  const kub = (v, d) => (S.KUBUN[Number(v)] ? Number(v) : d);
  const m = Math.floor(Number(b.endMonth));
  const input = {
    eatIn: num(b.eatIn), foodSales: num(b.foodSales), otherSales: num(b.otherSales),
    foodBuy: num(b.foodBuy), otherBuy: num(b.otherBuy), baseSales: base,
    foodKubun: kub(b.foodKubun, 2), eatInKubun: kub(b.eatInKubun, 4), otherKubun: kub(b.otherKubun, 2),
    invoice: b.invoice === true || b.invoice === '1' || b.invoice === 1,
    specifiedOver: b.specifiedOver === true || b.specifiedOver === '1' || b.specifiedOver === 1,
    current: KEYS.includes(b.current) ? b.current : 'general',
    who: b.who === 'corporate' ? 'corporate' : 'individual',
    endMonth: m >= 1 && m <= 12 ? m : 3,
  };
  if (!(input.eatIn + input.foodSales + input.otherSales + input.foodBuy + input.otherBuy > 0)) return { error: 'empty' };
  return { input };
}

/** 見本（無料の試算の「計算例」と同じ飲食店。今は本則課税） */
export const SAMPLE = {
  eatIn: 36000000, foodSales: 4000000, otherSales: 0, foodBuy: 12000000, otherBuy: 9000000, baseSales: 38000000,
  foodKubun: 3, eatInKubun: 4, otherKubun: 4, invoice: false, specifiedOver: false,
  current: 'general', who: 'individual', endMonth: 12,
};

// 方式を変える時の届出と期限。出せない移り方は null。
function filing(from, to, i, per, sellsFood) {
  const before = dayBefore(per.start);
  const special = i === 0 && sellsFood;
  if (from === 'simple' && to === 'general') {
    return special
      ? { form: '簡易課税制度選択不適用届出書', deadline: per.end, special: true }
      : { form: '簡易課税制度選択不適用届出書', deadline: before, special: false };
  }
  if (from === 'general' && to === 'simple') return { form: '簡易課税制度選択届出書', deadline: before, special: false };
  if (from === 'exempt' && to === 'general') {
    return special
      ? { form: '課税事業者選択届出書', deadline: per.end, special: true }
      : { form: '課税事業者選択届出書', deadline: before, special: false };
  }
  if ((from === 'general' || from === 'simple') && to === 'exempt') return { form: '課税事業者選択不適用届出書', deadline: before, special: false };
  // 免税⇄簡易は、免税（納税なし）より少なくならないので道に入れない
  return null;
}

/**
 * 通しの見通し。
 * @param input cleanPlan の結果
 * @param today きょう（YYYY-MM-DD）。期限が過ぎた届出の道は選ばない。
 */
export function plan(input, today) {
  const pers = periods(input.who, input.endMonth);
  const sellsFood = input.foodSales > 0;
  const now = S.compute({ ...input, foodRate: S.RATE.foodNow });
  const cut = S.compute({ ...input, foodRate: S.RATE.foodCut });
  const pick = (r, k) => r.options.find((o) => o.key === k);
  const allowed = {}; KEYS.forEach((k) => { allowed[k] = pick(cut, k).allowed; });
  const current = allowed[input.current] ? input.current : 'general';

  const table = pers.map((p) => {
    const tax = {};
    KEYS.forEach((k) => { tax[k] = Math.round(p.share * pick(cut, k).tax + (1 - p.share) * pick(now, k).tax); });
    return { ...p, tax };
  });

  // すべての道（方式の並び）を作り、決まりに合う物だけ残す
  const n = table.length;
  const usable = KEYS.filter((k) => allowed[k]);
  const paths = [];
  (function walk(i, seq) {
    if (i === n) { paths.push(seq); return; }
    usable.forEach((k) => walk(i + 1, seq.concat(k)));
  })(0, []);

  function check(seq) {
    const filings = [];
    let prev = current, lockSimple = 0, lockTaxable = 0;
    for (let i = 0; i < n; i++) {
      const m = seq[i];
      if (lockSimple > 0 && m !== 'simple') return null;      // 簡易を選んだら2期間は続ける
      if (lockTaxable > 0 && m === 'exempt') return null;      // 課税事業者を選んだら2期間は続ける
      if (lockSimple > 0) lockSimple--;
      if (lockTaxable > 0) lockTaxable--;
      if (m !== prev) {
        const f = filing(prev, m, i, table[i], sellsFood);
        if (!f) return null;
        if (f.deadline < today) return null;                   // 期限が過ぎた届出は出せない
        filings.push({ index: i, from: prev, to: m, ...f });
        if (m === 'simple') lockSimple = 1;                    // この期間と次の期間
        if (prev === 'exempt') lockTaxable = 1;
      }
      prev = m;
    }
    const taxes = seq.map((m, i) => table[i].tax[m]);
    return { path: seq, taxes, total: taxes.reduce((a, b) => a + b, 0), filings };
  }

  const valid = paths.map(check).filter(Boolean);
  const stay = valid.find((v) => v.path.every((m) => m === current));
  // 一番少ない道。同じ額なら、届出の少ない道（今のままを優先）
  const best = valid.reduce((a, b) => (b.total < a.total - 0.5 || (Math.abs(b.total - a.total) <= 0.5 && b.filings.length < a.filings.length) ? b : a), stay);

  // 1年目だけで選んだ時（無料の試算と同じ見方）: 1年目に一番少ない方式を選び、あとは決まりの中で一番少ない道
  const firstBest = usable.reduce((a, b) => (table[0].tax[b] < table[0].tax[a] ? b : a), current);
  const firstOnly = valid.filter((v) => v.path[0] === firstBest).reduce((a, b) => (!a || b.total < a.total ? b : a), null);

  const constant = usable.map((k) => {
    const v = valid.find((x) => x.path.every((m) => m === k));
    return { key: k, total: table.reduce((a, t) => a + t.tax[k], 0), reachable: !!v };
  });

  const notes = [];
  if (!allowed[input.current]) notes.push(`${LABEL[input.current]}は現在の条件では選択できないため、本則課税を現在の方式とみなして計算しております。`);
  if (current === 'simple') notes.push('簡易課税を始めてから2年が経過していない場合、通常の届出では本則課税に戻れません。令和9年4月1日を含む期間の特例でご提出いただく場合は、この決まりは適用されません。');
  if (best.path.includes('exempt') && current !== 'exempt') notes.push('免税事業者に戻るには、課税事業者を選択してから2年が経過している必要がございます。取引先が事業者の場合は、取引先が仕入れの税を控除できなくなります。');
  if (best.path.includes('exempt') && current === 'exempt') notes.push('免税のままであれば納税はございません。取引先が事業者の場合は、値下げを求められることがございます。');
  if (best.taxes.some((t) => t < 0)) notes.push('マイナスの期間は還付（納めた税金が戻ること）となります。還付金は申告の後に振り込まれます。');

  return {
    today, current, currentInput: input.current, sellsFood,
    periods: table.map((t) => ({ start: t.start, end: t.end, cutMonths: t.cutMonths, tax: t.tax })),
    allowed,
    stay: { method: current, taxes: stay.taxes, total: stay.total },
    best: {
      path: best.path, taxes: best.taxes, total: best.total, filings: best.filings,
      monthly: best.taxes.map((t) => (t > 0 ? Math.ceil(t / 12 / 100) * 100 : 0)), // 毎月の取り置き（100円単位に切り上げ）
    },
    saving: Math.round(stay.total - best.total),
    shouldSwitch: stay.total - best.total >= 1 && best.filings.length > 0,
    firstYear: firstOnly ? { method: firstBest, total: firstOnly.total, differs: firstBest !== best.path[0], loss: Math.round(firstOnly.total - best.total) } : null,
    constant,
    notes,
  };
}

/** パスが無い人に見せる分（道と届出は出さない） */
export function teaser(result) {
  return {
    periods: result.periods.length,
    from: result.periods[0].start,
    to: result.periods[result.periods.length - 1].end,
    saving: result.saving,
    shouldSwitch: result.shouldSwitch,
    firstYearDiffers: !!(result.firstYear && result.firstYear.differs && result.firstYear.loss >= 1),
  };
}
