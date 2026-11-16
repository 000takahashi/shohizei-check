// 有料の計算（2年間の通しの見通し・値付け）と、その窓口のテスト（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { plan, cleanPlan, periods, teaser, SAMPLE } from '../functions/_lib/plan.mjs';
import { pricing, cleanPricing, SAMPLE as PRICE_SAMPLE, PRICE_LIMIT } from '../functions/_lib/pricing.mjs';
import { onPlan, onPricing } from '../functions/api/paid.mjs';
import { signPass } from '../functions/_lib/pass.mjs';
const require = createRequire(import.meta.url);
const S = require('../site/calc.js');

const TODAY = '2026-11-12';
const run = (over = {}, today = TODAY) => plan(cleanPlan({ ...SAMPLE, ...over }).input, today);

test('課税期間: 1%が始まる期間から、1%の月が無くなる最初の期間まで', () => {
  assert.deepEqual(periods('individual').map((p) => [p.start, p.end, p.cutMonths]), [
    ['2027-01-01', '2027-12-31', 9], ['2028-01-01', '2028-12-31', 12], ['2029-01-01', '2029-12-31', 3], ['2030-01-01', '2030-12-31', 0],
  ]);
  assert.deepEqual(periods('corporate', 3).map((p) => [p.start, p.end, p.cutMonths]), [
    ['2027-04-01', '2028-03-31', 12], ['2028-04-01', '2029-03-31', 12], ['2029-04-01', '2030-03-31', 0],
  ]);
  // うるう年の2月決算
  assert.deepEqual(periods('corporate', 2).map((p) => p.end), ['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28']);
});

test('1つ目の期間の税額は、無料の試算（compare）と同じ', () => {
  const r = run();
  const c = S.compare({ ...SAMPLE, share: 9 / 12 });
  ['general', 'simple'].forEach((k) => assert.equal(r.periods[0].tax[k], Math.round(c.options.find((o) => o.key === k).tax)));
});

test('見本の飲食店: 簡易課税へ。届出は期間が始まる前の日まで。通しの差は今のままとの合計の差', () => {
  const r = run();
  assert.deepEqual(r.best.path, ['simple', 'simple', 'simple', 'simple']);
  assert.equal(r.best.filings.length, 1);
  assert.deepEqual({ form: r.best.filings[0].form, deadline: r.best.filings[0].deadline, special: r.best.filings[0].special },
    { form: '簡易課税制度選択届出書', deadline: '2026-12-31', special: false });
  assert.equal(r.saving, r.stay.total - r.best.total);
  assert.equal(r.saving, 3408000);
  assert.deepEqual(r.best.monthly, [122000, 120000, 126000, 128000]);
  assert.equal(r.shouldSwitch, true);
});

test('期限が過ぎた届出の道は選ばない（簡易は1つ目の期間からは選べず、2つ目から）', () => {
  const r = run({}, '2027-02-01');
  assert.equal(r.best.path[0], 'general');
  assert.equal(r.best.path[1], 'simple');
  assert.equal(r.best.filings[0].deadline, '2027-12-31');
  assert.equal(r.constant.find((c) => c.key === 'simple').reachable, false);
  assert.ok(r.best.filings.every((f) => f.deadline >= '2027-02-01'));
});

test('簡易課税を新しく選んだら、次の期間も簡易（2年は続ける）', () => {
  // 1年目と2年目は簡易が少なく、そのあとは本則が少ない事業でも、道のどこでも「簡易に入った次の期間」は簡易
  for (const over of [{}, { otherBuy: 20000000 }, { eatIn: 20000000, foodSales: 20000000, otherBuy: 16000000 }]) {
    const r = run(over);
    let prev = r.current;
    r.best.path.forEach((m, i) => {
      if (m === 'simple' && prev !== 'simple' && i + 1 < r.best.path.length) assert.equal(r.best.path[i + 1], 'simple');
      prev = m;
    });
  }
});

test('食品の卸（今は簡易）: 特例で、期間の中に出せば本則へ移れて還付になる', () => {
  const r = run({ eatIn: 0, foodSales: 30000000, foodBuy: 20000000, otherBuy: 6000000, baseSales: 30000000, current: 'simple', foodKubun: 1 });
  assert.equal(r.best.path[0], 'general');
  assert.deepEqual({ form: r.best.filings[0].form, deadline: r.best.filings[0].deadline, special: r.best.filings[0].special },
    { form: '簡易課税制度選択不適用届出書', deadline: '2027-12-31', special: true });
  assert.ok(r.best.taxes[1] < 0); // 丸1年が1%の年は還付
  assert.equal(r.best.monthly[1], 0); // 還付の年は取り置きなし
});

test('飲食料品を売っていない事業者には特例が無い（期間の前の日まで）', () => {
  const r = run({ foodSales: 0, eatIn: 10000000, foodBuy: 3000000, otherBuy: 9000000, baseSales: 9000000, current: 'simple' });
  r.best.filings.forEach((f) => assert.equal(f.special, false));
});

test('★今の方式を始めた時期: 2年たっていなければ、通常の届出ではその間は抜けられない（特例は別）', () => {
  // 飲食料品を売っていない・売上1,000万円超・今は簡易。本則が少ない事業
  const o = { foodSales: 0, eatIn: 20000000, foodBuy: 3000000, otherBuy: 15000000, baseSales: 20000000, current: 'simple' };
  assert.deepEqual(run({ ...o, since: 'old' }).best.path, ['general', 'general', 'general', 'general']);
  const last = run({ ...o, since: 'last' });
  assert.deepEqual(last.best.path.slice(0, 2), ['simple', 'general']);
  assert.equal(last.best.filings[0].deadline, '2027-12-31');
  const now = run({ ...o, since: 'this' });
  assert.deepEqual(now.best.path.slice(0, 3), ['simple', 'simple', 'general']);
  assert.ok(now.notes.some((n) => n.includes('その決まりを入れて計算しております')));
  // 食品の卸は、令和9年4月1日を含む期間の特例なら、始めたばかりでも本則へ移れる
  const w = { eatIn: 0, foodSales: 30000000, foodBuy: 20000000, otherBuy: 6000000, baseSales: 30000000, current: 'simple', foodKubun: 1 };
  const sp = run({ ...w, since: 'this' });
  assert.equal(sp.best.path[0], 'general');
  assert.equal(sp.best.filings[0].special, true);
  // 届出で課税事業者を選んだばかりの人（選択済みの見通し）は、その間は免税に戻らない
  const g = run({ eatIn: 0, foodSales: 9000000, foodBuy: 2000000, otherBuy: 1000000, baseSales: 9000000, current: 'general', foodKubun: 2, since: 'this' });
  // 始めた時期を選んだ人は、今の方式から出発する道だけが主の結果（免税からの道と混ぜない）
  assert.equal(g.twoStarts, false);
  assert.equal(g.ifElected, null);
  assert.notEqual(g.best.path[0], 'exempt');
  assert.notEqual(g.best.path[1], 'exempt');
  assert.equal(run({ eatIn: 0, foodSales: 9000000, foodBuy: 2000000, otherBuy: 1000000, baseSales: 9000000, current: 'general', foodKubun: 2, since: 'old' }).twoStarts, true);
  // 簡易を始めたばかりの人も、主の結果で最初の期間から免税にはならない
  const s1 = run({ eatIn: 0, foodSales: 9000000, foodBuy: 2000000, otherBuy: 1000000, baseSales: 9000000, current: 'simple', foodKubun: 2, since: 'last' });
  assert.equal(s1.twoStarts, false);
  assert.equal(s1.best.path[0], 'simple');
  assert.equal(cleanPlan({ ...SAMPLE, since: 'x' }).input.since, 'old');
});

test('★選択届を出しているか: 出している人は今の方式から、出していない人は免税から。わからない人は両方', () => {
  const o = { eatIn: 0, foodSales: 9000000, foodBuy: 2000000, otherBuy: 1000000, baseSales: 9000000, current: 'general', foodKubun: 2 };
  const un = run(o);
  assert.equal(cleanPlan(o).input.elected, 'unknown');
  assert.equal(un.twoStarts, true);
  assert.ok(un.ifElected);
  const yes = run({ ...o, elected: 'yes' });
  assert.equal(yes.twoStarts, false);
  assert.equal(yes.ifElected, null);
  assert.deepEqual(yes.best.path, un.ifElected.path); // 出している人の主の結果は、わからない人の2つ目の欄と同じ
  const no = run({ ...o, elected: 'no' });
  assert.equal(no.twoStarts, true);
  assert.equal(no.ifElected, null);
  assert.deepEqual(no.best.path, un.best.path);
  assert.ok(no.notes.some((n) => n.startsWith('この見通しは、課税事業者選択届出書を出していない方')));
  assert.ok(!no.notes.some((n) => n.includes('「すでに課税事業者選択届出書を出している場合」')));
  // 始めたばかりでも、出していないと答えた人は免税から（選んだ2年の決まりは無い）
  const noNew = run({ ...o, elected: 'no', since: 'this' });
  assert.equal(noNew.twoStarts, true);
  assert.ok(!noNew.notes.some((n) => n.startsWith('届出で課税事業者を選んでから2年間')));
  // 売上が1,000万円を超えていれば、答えにかかわらず今の方式から
  assert.equal(run({ ...o, baseSales: 20000000, elected: 'no' }).twoStarts, false);
});

test('免税から課税事業者を選んだら、次の期間は免税に戻れない', () => {
  const r = run({ eatIn: 0, foodSales: 9000000, foodBuy: 5000000, otherBuy: 3000000, baseSales: 9000000, current: 'exempt', foodKubun: 2 });
  assert.equal(r.allowed.exempt, true);
  const i = r.best.path.findIndex((m) => m !== 'exempt');
  if (i >= 0 && i + 1 < r.best.path.length) assert.notEqual(r.best.path[i + 1], 'exempt');
  assert.ok(r.best.total <= r.stay.total);
});

test('特定期間は給与等の支払額でも判定できると書く（国税庁 No.6501）', () => {
  const r = run({ eatIn: 0, foodSales: 9000000, otherSales: 0, foodBuy: 1000000, otherBuy: 0, baseSales: 9000000, current: 'general', foodKubun: 2 });
  assert.ok(r.notes.some((t) => t.includes('給与等の支払額')));
  const { readFileSync } = require('node:fs');
  for (const f of ['planui.js', 'yearui.js', 'calc.js']) {
    const src = readFileSync(new URL('../site/' + f, import.meta.url), 'utf8');
    assert.ok(src.includes('給与等の支払額'), f);
    assert.ok(!src.includes('特定期間の売上も1,000万円以下'), f);
  }
});

// 売上900万円・本則・インボイス登録なしの個人（国税庁 No.6501・No.6629）
const LOW = { eatIn: 0, baseSales: 9000000, current: 'general', invoice: false, foodKubun: 2 };
const forms = (fs) => fs.map((f) => [f.form, f.deadline || f.when]);

test('★売上が下がった人: 出発点は免税。1つ目の期間が免税なら「納税義務者でなくなった旨の届出書」を速やかに。日をまたいでも同じ', () => {
  const o = { ...LOW, foodSales: 9000000, otherSales: 0, foodBuy: 1000000, otherBuy: 0 };
  const a = run(o, '2026-11-14'), b = run(o, '2027-01-02');
  assert.equal(a.twoStarts, true);
  assert.equal(a.best.path.join(), 'exempt,exempt,exempt,exempt');
  assert.equal(b.best.total, a.best.total);
  assert.deepEqual(forms(a.best.filings), [['消費税の納税義務者でなくなった旨の届出書', '速やかに']]);
  // 選択済みの人: 期限の内は同じ道（届出は不適用届）、期限を過ぎたら1つ目の期間は本則
  assert.equal(a.ifElected.same, true);
  assert.deepEqual(forms(a.ifElected.filings), [['課税事業者選択不適用届出書', '2026-12-31']]);
  assert.equal(b.ifElected.same, false);
  assert.equal(b.ifElected.path[0], 'general');
});

test('★新たに課税事業者を選ぶ人は、2年間は課税のまま（本則→免税→本則のような道は出さない）', () => {
  // レビューの例1: 食品売上200万円・その他売上700万円・食材仕入1,000万円・10%経費600万円
  const r = run({ ...LOW, foodSales: 2000000, otherSales: 7000000, foodBuy: 10000000, otherBuy: 6000000 }, '2026-11-15');
  const p = r.best.path;
  for (let i = 0; i < p.length; i++) if (p[i] !== 'exempt' && (i === 0 || p[i - 1] === 'exempt')) assert.notEqual(p[i + 1], 'exempt', p.join());
  assert.equal(r.best.filings[0].form, '課税事業者選択届出書');
  assert.equal(r.best.filings[0].elect, true);
  // 選択済みで2年を過ぎた人は、本則→免税→本則もありうる（別の道として返す）
  assert.equal(r.ifElected.same, false);
  assert.equal(r.ifElected.path.join(), 'general,exempt,general,general');
});

test('★最初の課税事業者選択届出書と期限を、届出の一覧・CSV・カレンダーに載せる', () => {
  // レビューの例2: 食品売上900万円・食材500万円・10%経費200万円 → 2027・2028年は本則で還付
  const r = run({ ...LOW, foodSales: 9000000, otherSales: 0, foodBuy: 5000000, otherBuy: 2000000 }, '2026-11-15');
  assert.deepEqual(r.best.path.slice(0, 2), ['general', 'general']);
  assert.deepEqual(forms(r.best.filings), [['課税事業者選択届出書', '2027-12-31'], ['課税事業者選択不適用届出書', '2028-12-31']]);
  assert.equal(r.best.filings[0].special, true); // 飲食料品の特例: この期間の中に
  // 選択済みの人には選択届は要らない
  assert.deepEqual(forms(r.ifElected.filings), [['課税事業者選択不適用届出書', '2028-12-31']]);
  const csv = require('../site/plancsv.js').rows(r, '2026-11-15').map((x) => x.join(',')).join('\n');
  assert.match(csv, /課税事業者選択届出書,2027-12-31,2027年1月〜2027年12月,免税事業者（課税事業者を選択）,本則課税,飲食料品特例/);
  assert.match(csv, /すでに課税事業者選択届出書を出していて、2年を過ぎている場合/);
  const ui = require('node:fs').readFileSync(new URL('../site/planui.js', import.meta.url), 'utf8');
  assert.match(ui, /calEvents\(r, r\.best\.filings/); // カレンダーは届出の一覧から作る（速やかに出す届出は入れない）
});

test('売上が1,000万円を超える人・インボイス登録の人は、今の方式から出発する（2つに分けない）', () => {
  assert.equal(run({}).twoStarts, false);
  assert.equal(run({}).ifElected, null);
  assert.equal(run({ ...LOW, foodSales: 9000000, foodBuy: 5000000, otherBuy: 2000000, invoice: true }).twoStarts, false);
});

test('今のままが一番少ない時は、届出なし', () => {
  const r = run({ current: 'simple' });
  assert.equal(r.shouldSwitch, false);
  assert.equal(r.best.filings.length, 0);
  assert.equal(r.saving, 0);
});

test('入力: 空は断る。おかしな値は0や既定にする', () => {
  assert.equal(cleanPlan({}).error, 'empty');
  assert.equal(cleanPlan(null).error, 'bad_input');
  const c = cleanPlan({ eatIn: '1000', foodSales: -5, foodKubun: 9, current: 'x', who: 'y', endMonth: 99 }).input;
  assert.deepEqual([c.eatIn, c.foodSales, c.foodKubun, c.current, c.who, c.endMonth], [1000, 0, 2, 'general', 'individual', 3]);
});

test('値付け: 本体を変えない・税込みを変えない・同じ値段', () => {
  const r = pricing(cleanPricing(PRICE_SAMPLE).input);
  const b = r.rows[0];
  assert.equal(b.keepBase.price, 808);          // 864 ÷ 1.08 × 1.01
  assert.equal(b.keepBase.customerSaves, 56);
  assert.equal(b.keepPrice.gainPerSale, 55.4);  // 864 ÷ 1.01 − 800
  assert.equal(b.gap.now, 16);
  assert.equal(b.gap.after, 72);
  // 同じ値段: 売上の本体の合計が変わらない
  const s = 0.6, u = (s * 880 / 1.1 + (1 - s) * 864 / 1.08) / (s / 1.1 + (1 - s) / 1.01);
  assert.equal(b.same.price, Math.round(u));
  assert.ok(b.same.round10 % 10 === 0 && b.same.round10 >= b.same.price);
  assert.equal(r.rows[3].same, undefined);      // 店内の値段が無い商品
  assert.equal(r.totals.customerSaves, 56 + 35 + 21 + 24);
});

test('値付けの入力: 数の上限・名前の掃除・空', () => {
  assert.equal(cleanPricing({ items: [] }).error, 'empty');
  assert.equal(cleanPricing({ items: new Array(PRICE_LIMIT.items + 1).fill({ takeout: 100 }) }).error, 'too_many');
  const c = cleanPricing({ items: [{ name: '<b>弁当</b>' + 'あ'.repeat(80), takeout: 540 }, { name: 'x' }], eatInShare: 300 }).input;
  assert.equal(c.items.length, 1);
  assert.ok(!/[<>]/.test(c.items[0].name) && c.items[0].name.length <= PRICE_LIMIT.name);
  assert.equal(c.eatInShare, 100);
});

// ---- 窓口 ----
const SECRET = 'test-secret-for-pass-signing';
const NOW = Date.parse('2026-12-01T03:00:00Z'); // 無料開放（11月30日まで）が終わったあと
const req = (path, body, token) => new Request('https://shohizei-check.com' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body),
});

test('★有料の線: パスが無ければ 402。道・届出・値段の表は返さない。金額の一部だけ返す', async () => {
  // 署名の鍵が無い間は、パスが要るとは言わず 503（買った方を「パスが無い」と案内しない）
  for (const call of [onPlan, onPricing]) {
    const down = await call({ request: req(call === onPlan ? '/api/v1/plan' : '/api/v1/pricing', call === onPlan ? SAMPLE : PRICE_SAMPLE), env: {} }, { now: NOW });
    assert.equal(down.status, 503);
    assert.equal((await down.json()).teaser, undefined);
  }
  for (const env of [{ PASS_SIGNING_SECRET: SECRET }]) {
    const res = await onPlan({ request: req('/api/v1/plan', SAMPLE), env }, { now: NOW });
    assert.equal(res.status, 402);
    const out = await res.json();
    assert.deepEqual(Object.keys(out).sort(), ['error', 'teaser']);
    assert.deepEqual(Object.keys(out.teaser).sort(), ['firstYearDiffers', 'from', 'periods', 'saving', 'shouldSwitch', 'to']);
    assert.ok(!JSON.stringify(out).includes('届出書'));
    const pr = await onPricing({ request: req('/api/v1/pricing', PRICE_SAMPLE), env }, { now: NOW });
    assert.equal(pr.status, 402);
    assert.deepEqual(Object.keys((await pr.json()).teaser).sort(), ['items', 'withBoth']);
  }
});

test('本物のパスなら結果が出る。期限切れ・にせ物は 402', async () => {
  const env = { PASS_SIGNING_SECRET: SECRET };
  const good = await signPass(SECRET, NOW / 1000 + 3600, 'abc');
  const res = await onPlan({ request: req('/api/v1/plan', SAMPLE, good), env }, { now: NOW });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.result.saving, 3408000);
  assert.equal(out.result.today, '2026-12-01');
  assert.equal((await onPricing({ request: req('/api/v1/pricing', PRICE_SAMPLE, good), env }, { now: NOW })).status, 200);
  const old = await signPass(SECRET, NOW / 1000 - 10, 'abc');
  assert.equal((await onPlan({ request: req('/api/v1/plan', SAMPLE, old), env }, { now: NOW })).status, 402);
  const fake = await signPass('another-secret', NOW / 1000 + 3600, 'abc');
  assert.equal((await onPlan({ request: req('/api/v1/plan', SAMPLE, fake), env }, { now: NOW })).status, 402);
});

test('見本は誰でも見られる。ただし見本の数字でしか計算しない', async () => {
  const res = await onPlan({ request: req('/api/v1/plan', { sample: true, eatIn: 999999999 }), env: {} }, { now: NOW });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.sample, true);
  assert.equal(out.result.saving, 3408000);
  assert.equal((await onPricing({ request: req('/api/v1/pricing', { sample: true }), env: {} })).status, 200);
});

test('窓口の守り: POST だけ・大きすぎる本文・空・JSONでない物は断る。PAID_OPEN=1 は試し用', async () => {
  assert.equal((await onPlan({ request: new Request('https://shohizei-check.com/api/v1/plan'), env: {} })).status, 405);
  assert.equal((await onPlan({ request: req('/api/v1/plan', { x: 'a'.repeat(5000) }), env: {} })).status, 413);
  assert.equal((await onPlan({ request: req('/api/v1/plan', {}), env: {} })).status, 400);
  const bad = new Request('https://shohizei-check.com/api/v1/plan', { method: 'POST', body: 'not json' });
  assert.equal((await onPlan({ request: bad, env: {} })).status, 400);
  assert.equal((await onPlan({ request: req('/api/v1/plan', SAMPLE), env: { PAID_OPEN: '1' } }, { now: NOW })).status, 200);
});

test('★無料開放: 11月30日（日本時間）の終わりまでは、パスなしで結果が出る。12月1日からは 402', async () => {
  const Shop = createRequire(import.meta.url)('../site/shopinfo.js');
  const env = { PASS_SIGNING_SECRET: SECRET };
  assert.equal(Shop.FREE_UNTIL, '2026-11-30'); // 運営者が決めた期間。勝手に延ばさない
  const last = Date.parse('2026-11-30T14:59:00Z'); // 日本時間 11月30日 23:59
  const next = Date.parse('2026-11-30T15:00:00Z'); // 日本時間 12月1日 0:00
  assert.equal((await onPlan({ request: req('/api/v1/plan', SAMPLE), env }, { now: last })).status, 200);
  assert.equal((await onPricing({ request: req('/api/v1/pricing', PRICE_SAMPLE), env }, { now: last })).status, 200);
  assert.equal((await onPlan({ request: req('/api/v1/plan', SAMPLE), env }, { now: next })).status, 402);
  assert.equal((await onPricing({ request: req('/api/v1/pricing', PRICE_SAMPLE), env }, { now: next })).status, 402);
});
