// 消費税1%チェッカー（Cloudflare Workers）
// /api/v1/* は functions/ の処理で答え、それ以外は site/ の静的ファイルを返す。
// www 付きは正式なURLへ転送し、仮URL（*.workers.dev）は検索に載せない。
import { onStatus as passStatus, onCheckout as passCheckout, onClaim as passClaim } from '../functions/api/pass.mjs';
import { onPlan, onPricing } from '../functions/api/paid.mjs';

const ROUTES = {
  '/api/v1/plan': onPlan,       // 有料: 2年間の通しの見通し
  '/api/v1/pricing': onPricing, // 有料: 持ち帰り・店内の値付け
  '/api/v1/pass/status': passStatus, '/api/v1/pass/checkout': passCheckout, '/api/v1/pass/claim': passClaim, // 有料パスを買う・受け取る
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.shohizei-check.com') {
      url.hostname = 'shohizei-check.com';
      return Response.redirect(url.toString(), 301);
    }
    const handler = ROUTES[url.pathname.replace(/\/+$/, '') || '/'];
    let res = handler ? await handler({ request, env }) : await env.ASSETS.fetch(request);
    if (url.hostname.endsWith('.workers.dev')) {
      res = new Response(res.body, res);
      res.headers.set('X-Robots-Tag', 'noindex');
    }
    return res;
  },
};
