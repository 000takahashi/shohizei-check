// 有料の計算の窓口。
//   POST /api/v1/plan     2年間の通しの見通し（方式の道・届出と期限・毎月の取り置き）
//   POST /api/v1/pricing  持ち帰り・店内の値付けの案
// Authorization: Bearer <パス> が要る。計算はサーバーでして、入力も結果も保存しない。AIは使わない。
// - { sample: true } は見本の数字で計算して返す（パスなしで中身を見てもらうため）。
// - パスが無い時は 402 と、結果の一部だけ（teaser）を返す。道・届出・値段の表は返さない。
// - 無料開放の期間（site/shopinfo.js の FREE_UNTIL まで）は、パスなしで通す。
// - PAID_OPEN=1 の間は、売り出し前の試し用にパスなしで通す。
import { json, readJson, todayJst } from '../_lib/http.mjs';
import { verifyPass, bearer } from '../_lib/pass.mjs';
import Shop from '../../site/shopinfo.js';
import { cleanPlan, plan, teaser as planTeaser, SAMPLE as PLAN_SAMPLE } from '../_lib/plan.mjs';
import { cleanPricing, pricing, teaser as priceTeaser, SAMPLE as PRICE_SAMPLE } from '../_lib/pricing.mjs';

const NOTE = '結果は目安でございます。売上と仕入れが毎年同じと仮定しております。届出と申告につきましては、税理士または税務署にご確認ください。';

function make(clean, run, tease, SAMPLE, max) {
  return async function onRequest(context, deps = {}) {
    const { request, env } = context;
    if (request.method !== 'POST') return json({ error: 'use_post' }, 405, { Allow: 'POST' });
    const read = await readJson(request, max);
    if (read.error) return json({ error: read.error }, read.status);
    const body = read.body;
    const today = todayJst(deps.now);
    if (body && body.sample === true) {
      return json({ sample: true, input: SAMPLE, result: run(clean(SAMPLE).input, today), note: NOTE });
    }
    const c = clean(body);
    if (c.error) return json({ error: c.error }, 400);
    const result = run(c.input, today);
    if (env.PAID_OPEN !== '1' && !Shop.freeOpen(deps.now)) {
      const pass = await verifyPass(env.PASS_SIGNING_SECRET, bearer(request), deps.now);
      if (!pass.ok) return json({ error: pass.reason, teaser: tease(result) }, 402);
    }
    return json({ result, note: NOTE });
  };
}

export const onPlan = make(cleanPlan, plan, planTeaser, PLAN_SAMPLE, 4 * 1024);
export const onPricing = make(cleanPricing, (input) => pricing(input), priceTeaser, PRICE_SAMPLE, 48 * 1024);
