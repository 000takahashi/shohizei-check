// AI 向けの道具（MCP と /api/v1/* で同じ物を出す）。どれも鍵なし・無料で、画面の無料の試算と同じ計算をそのまま使う。
// 有料の計算（2年間の通しの見通し /api/v1/plan・値付け /api/v1/pricing）はここに入れない＝無料に広げない。
// 計算はサーバーでして、入力も結果も保存しない。AI は使わない。
import S from '../../site/calc.js';
import Y from '../../site/yearkit.js';

export const SITE = 'https://shohizei-check.com';
export const DISCLAIMER =
  'Estimates only, not individual tax advice. The 1% rate (April 1, 2027 to March 31, 2029) is a plan that assumes the bill passes the Diet. ' +
  'Confirm filings with a tax accountant or the tax office. ' +
  '結果は目安でございます（法案の成立が前提です）。届出と申告につきましては、税理士または税務署にご確認ください。';
const SOURCE = 'National Tax Agency pamphlet 「飲食料品に係る2年間の消費税率引下げについて」 (September 2026)';
const LABEL = { general: '本則課税', simple: '簡易課税', exempt: '免税事業者' };
const LABEL_EN = { general: 'standard taxation', simple: 'simplified taxation', exempt: 'tax-exempt' };
const yen = (n) => Math.round(n);

const money = (d) => ({ type: 'number', minimum: 0, maximum: 1e12, description: d });
const kubun = (d) => ({ type: 'integer', minimum: 1, maximum: 6, description: d + ' Simplified-taxation business type 1-6 (1 wholesale 90%, 2 retail 80%, 3 manufacturing/takeout cooked food 70%, 4 eat-in restaurant 60%, 5 services 50%, 6 real estate 40%).' });
const WHO = {
  who: { type: 'string', enum: ['individual', 'corporate'], description: 'individual (taxable period = calendar year) or corporate. Default individual.' },
  endMonth: { type: 'integer', minimum: 1, maximum: 12, description: 'Corporate fiscal year-end month (1-12). Default 3. Ignored for individuals.' },
};
const BUSINESS = {
  eatIn: money('Annual eat-in and catering sales, excluding tax, in yen (stays at 10%).'),
  foodSales: money('Annual sales of food and non-alcoholic drinks (takeout, delivery, wholesale, retail), excluding tax, in yen (8% now, 1% during the cut).'),
  otherSales: money('Annual other sales at 10% (alcohol, goods), excluding tax, in yen.'),
  foodBuy: money('Annual purchases of food at the reduced rate, excluding tax, in yen.'),
  otherBuy: money('Annual purchases and expenses at 10% (alcohol, supplies, rent, utilities, equipment), excluding tax, in yen.'),
  baseSales: money('Taxable sales in the base period (two years before), in yen. Needed to judge whether tax-exempt status (10 million yen or less) or simplified taxation (50 million yen or less) is allowed. If omitted, tax-exempt status is treated as not allowed.'),
  current: { type: 'string', enum: ['general', 'simple', 'exempt'], description: 'Current filing method: general (standard), simple (simplified) or exempt. Default general.' },
  preset: { type: 'string', enum: Object.keys(S.PRESETS), description: 'Business type used for default simplified-taxation types: ' + Object.entries(S.PRESETS).map(([k, v]) => `${k} (${v.label})`).join(', ') + '.' },
  foodKubun: kubun('Type for food sales. Default from preset, else 2.'),
  eatInKubun: kubun('Type for eat-in sales. Default 4.'),
  otherKubun: kubun('Type for other sales. Default from preset, else 2.'),
  amountsIncludeTax: { type: 'boolean', description: 'true if the five sales and purchase amounts include tax (food at 8%, others at 10%), as on the site\'s 税込 input. Default false (excluding tax).' },
  invoice: { type: 'boolean', description: 'Registered as a qualified invoice issuer (then tax-exempt status is not allowed). Default false.' },
  specifiedOver: { type: 'boolean', description: 'In the specified period (e.g. January-June of the previous year) both sales and salaries exceeded 10 million yen. Default false.' },
  ...WHO,
};
const FLOWS = ['eatIn', 'foodSales', 'otherSales', 'foodBuy', 'otherBuy'];

// 税込みで入れた時に、税抜きへ戻す率（画面の TAXR と同じ。食料品は今の8%で入れる前提）
const TAXR = { eatIn: 1.10, foodSales: 1.08, otherSales: 1.10, foodBuy: 1.08, otherBuy: 1.10 };
function toInput(a) {
  const pre = a.preset ? S.PRESETS[a.preset] : null;
  const f = (k) => (a.amountsIncludeTax ? Math.round((a[k] || 0) / TAXR[k]) : a[k] || 0);
  return {
    eatIn: f('eatIn'), foodSales: f('foodSales'), otherSales: f('otherSales'), foodBuy: f('foodBuy'), otherBuy: f('otherBuy'),
    baseSales: a.baseSales === undefined ? undefined : a.baseSales,
    current: a.current || 'general',
    foodKubun: a.foodKubun || (pre ? pre.foodKubun : 2),
    eatInKubun: a.eatInKubun || 4,
    otherKubun: a.otherKubun || (pre ? pre.otherKubun : 2),
    invoice: !!a.invoice, specifiedOver: !!a.specifiedOver,
  };
}
const blank = (a) => FLOWS.every((k) => !a[k]);
const BLANK_ERROR = { error: 'no_amounts', message: 'Enter at least one annual sales or purchase amount (eatIn, foodSales, otherSales, foodBuy, otherBuy).' };
const who = (a) => (a.who === 'corporate' ? 'corporate' : 'individual');
const endMonth = (a) => a.endMonth || 3;
const method = (o) => ({ key: o.key, label: LABEL[o.key], labelEn: LABEL_EN[o.key], allowed: o.allowed, taxYen: o.allowed ? yen(o.tax) : null });

export const TOOLS = [
  {
    name: 'compare_tax_methods',
    title: 'Food consumption tax 1%: compare filing methods',
    description:
      'For a restaurant or food seller in Japan, compare the consumption tax payable under standard taxation (本則課税), simplified taxation (簡易課税) ' +
      'and tax-exempt status (免税) for the taxable period that includes April 1, 2027, when the tax on food is planned to drop from 8% to 1% ' +
      '(the period is prorated by month between 8% and 1%). Returns the cheapest allowed method, the change from today, and the notification to file with its deadline. ' +
      'Amounts are annual and exclude tax unless amountsIncludeTax is true. Negative tax means a refund. ' + DISCLAIMER,
    inputSchema: { type: 'object', properties: BUSINESS, additionalProperties: false },
    run(a) {
      if (blank(a)) return BLANK_ERROR;
      const p = toInput(a);
      const pr = S.period(who(a), endMonth(a));
      const months = S.cutMonths(pr.start, pr.end);
      const c = S.compare({ ...p, share: months / 12 });
      const st = S.steps(c.current, c.bestKey, who(a), endMonth(a), p.foodSales > 0, c.cut.canExempt, c.currentInput);
      return {
        taxablePeriod: { start: pr.start, end: pr.end, monthsAt1Percent: months },
        currentMethod: c.current, currentMethodInput: c.currentInput, currentMethodAllowed: c.currentAllowed,
        methods: c.options.map(method),
        best: { key: c.bestKey, label: LABEL[c.bestKey], labelEn: LABEL_EN[c.bestKey], taxYen: yen(c.bestTax) },
        nowMethod: c.nowKey, nowTaxYen: yen(c.nowTax),
        stayTaxYen: yen(c.stayTax),
        changeIfStayYen: yen(c.changeIfStay),
        saveBySwitchYen: yen(c.saveBySwitch),
        shouldSwitch: c.shouldSwitch,
        fullYearAt1Percent: { bestKey: c.full.bestKey, bestTaxYen: yen(c.full.bestTax), stayTaxYen: yen(c.full.stayTax) },
        filing: { needed: !!st.need, form: st.form || null, deadline: st.deadline || null, specialRule: !!st.special, note: st.text },
        notes: c.notes,
        assumptions: [
          'Sales and purchases occur evenly through the year (the period is prorated by month).',
          'Rounding and the 75% rule of simplified taxation are not included.',
          'The 20%/30% special rules are not included: individuals who became taxable by registering for the invoice system, with base-period sales of 10 million yen or less, may pay 30% of the output tax for 2027 and 2028 (no notification needed). Those who used the 20%/30% rule can file for simplified taxation until the tax return deadline of the next year (for 2027, by March 31, 2028).',
        ],
        paidFeatures: 'A multi-year plan across all periods of the cut (POST /api/v1/plan) and takeout/eat-in pricing (POST /api/v1/pricing) need a paid pass (Authorization: Bearer). See ' + SITE + '/llms.txt',
        source: SOURCE, page: SITE + '/', disclaimer: DISCLAIMER,
      };
    },
  },
  {
    name: 'get_filing_period',
    title: 'Taxable period that includes April 1, 2027 and filing deadlines',
    description:
      'From individual/corporate and the fiscal year-end month, return the taxable period that includes April 1, 2027, how many months of it are at the 1% food rate, ' +
      'the deadline for the special-rule notifications (simplified→standard, exempt→taxable: within that period) and the deadline for switching to simplified taxation (the day before the period starts). ' + DISCLAIMER,
    inputSchema: { type: 'object', properties: WHO, additionalProperties: false },
    run(a) {
      const pr = S.period(who(a), endMonth(a));
      const before = new Date(Date.parse(pr.start + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
      return {
        cut: { from: S.CUT_START, to: S.CUT_END, foodRatePercent: 1 },
        taxablePeriod: { start: pr.start, end: pr.end, monthsAt1Percent: S.cutMonths(pr.start, pr.end) },
        deadlines: [
          { form: '簡易課税制度選択不適用届出書', move: 'simplified → standard', deadline: pr.deadline, specialRule: true, condition: 'Only for businesses that sell food. Otherwise the day before the period starts: ' + before + '.' },
          { form: '課税事業者選択届出書', move: 'tax-exempt → taxable (standard)', deadline: pr.deadline, specialRule: true, condition: 'Only for businesses that sell food. Otherwise the day before the period starts: ' + before + '.' },
          { form: '簡易課税制度選択届出書', move: 'standard → simplified', deadline: before, specialRule: false, condition: 'No special rule. Must be kept for 2 years. Exception: an individual who used the 20% special rule for 2026 can file by ' + S.SIMPLE_AFTER_TOKUREI.individual + ' (the 2027 return deadline) to use simplified taxation from 2027.' },
        ],
        page: SITE + '/#deadline', disclaimer: DISCLAIMER,
      };
    },
  },
  {
    name: 'compare_normal_year',
    title: 'Filing method for a year with food at 8%',
    description:
      'Compare standard taxation, simplified taxation and tax-exempt status for one year with food at the normal 8% rate (before or after the 1% period), ' +
      'and return the next taxable period that starts after today with the deadline to file a change (the day before it starts). Same inputs as compare_tax_methods. ' + DISCLAIMER,
    inputSchema: { type: 'object', properties: BUSINESS, additionalProperties: false },
    run(a) {
      if (blank(a)) return BLANK_ERROR;
      const p = toInput(a);
      const r = Y.normalYear(p);
      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const np = Y.nextPeriod(who(a), endMonth(a), today);
      const notes = [];
      if (!r.currentAllowed) notes.push('The current method is not allowed under these conditions; standard taxation is treated as the current method.');
      if (np.cutMonths > 0) notes.push(`The next taxable period includes ${np.cutMonths} month(s) at 1%. Use compare_tax_methods for that period.`);
      if (r.shouldSwitch && r.bestKey === 'simple') notes.push('Simplified taxation must be kept for 2 years once chosen.');
      if (r.bestKey === 'exempt' && r.shouldSwitch) notes.push('How to return to tax-exempt status depends on why the business became taxable; invoice registration must also be cancelled.');
      return {
        foodRatePercent: 8,
        currentMethod: r.current, currentMethodAllowed: r.currentAllowed,
        methods: r.options.map(method),
        best: { key: r.bestKey, label: LABEL[r.bestKey], labelEn: LABEL_EN[r.bestKey], taxYen: yen(r.bestTax) },
        stayTaxYen: yen(r.stayTax), savingYen: yen(r.saving), shouldSwitch: r.shouldSwitch,
        form: r.form,
        nextTaxablePeriod: { start: np.start, end: np.end, deadlineToChange: np.deadline, monthsAt1Percent: np.cutMonths },
        notes, page: SITE + '/#year', disclaimer: DISCLAIMER,
      };
    },
  },
];
export const TOOL = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
