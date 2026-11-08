// 消費税1%チェッカー（Cloudflare Workers）
// site/ の静的ファイルを返す。www 付きは正式なURLへ転送し、仮URL（*.workers.dev）は検索に載せない。
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.shohizei-check.com') {
      url.hostname = 'shohizei-check.com';
      return Response.redirect(url.toString(), 301);
    }
    let res = await env.ASSETS.fetch(request);
    if (url.hostname.endsWith('.workers.dev')) {
      res = new Response(res.body, res);
      res.headers.set('X-Robots-Tag', 'noindex');
    }
    return res;
  },
};
