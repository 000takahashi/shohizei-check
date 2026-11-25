// 消費税1%チェッカー（Cloudflare Workers）
// /mcp と /api/v1/* は functions/ の処理で答え、それ以外は site/ の静的ファイルを返す。
// www 付きは正式なURLへ転送し、仮URL（*.workers.dev）は検索に載せない。
import { count } from './count.mjs';
import { maintenanceOn, passThrough, maintenanceResponse } from './maintenance.mjs';
import { onStatus as passStatus, onCheckout as passCheckout, onClaim as passClaim, onCheck as passCheck, onRecover as passRecover } from '../functions/api/pass.mjs';
import { onPlan, onPricing } from '../functions/api/paid.mjs';
import { onRequest as mcp } from '../functions/mcp.mjs';
import { onCompare, onPeriod, onNormalYear } from '../functions/api/open.mjs';

const ROUTES = {
  // AI 向けの窓口（鍵なし・無料の試算と同じ計算だけ）。中身は functions/_lib/tools.mjs
  '/mcp': mcp,
  '/api/v1/compare': onCompare, '/api/v1/period': onPeriod, '/api/v1/normal-year': onNormalYear,
  '/api/v1/plan': onPlan,       // 有料: 2年間の通しの見通し
  '/api/v1/pricing': onPricing, // 有料: 持ち帰り・店内の値付け
  '/api/v1/pass/status': passStatus, '/api/v1/pass/checkout': passCheckout, '/api/v1/pass/claim': passClaim, '/api/v1/pass/check': passCheck, '/api/v1/pass/recover': passRecover, // 有料パスを買う・受け取る
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === 'www.shohizei-check.com') {
      url.hostname = 'shohizei-check.com';
      return Response.redirect(url.toString(), 301);
    }
    const path = url.pathname.replace(/\/+$/, '') || '/';
    // 更新中のあいだは、ページも窓口も「休止中」を返す（src/maintenance.mjs・戻すときはそこを false に）
    if (maintenanceOn(env) && !passThrough(path)) {
      const res = maintenanceResponse(path);
      count(env, ctx, 'shohizei', request, res, false);
      return res;
    }
    const handler = ROUTES[path];
    let res = handler ? await handler({ request, env }) : await env.ASSETS.fetch(request);
    if (url.hostname.endsWith('.workers.dev')) {
      res = new Response(res.body, res);
      res.headers.set('X-Robots-Tag', 'noindex');
    }
    count(env, ctx, 'shohizei', request, res, !!handler); // 日ごとの合計の数だけ（src/count.mjs）
    return res;
  },
};
