// 窓口（/api/v1/*）の共通の道具。このサイトの画面からだけ呼ぶので、よそのサイトからの呼び出し（CORS）は許さない。
export const SITE = 'https://shohizei-check.com';

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...extra } });
}

// POST の JSON を、大きさの上限つきで読む。失敗は { error, status } を返す。
export async function readJson(request, max = 16 * 1024) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) return { error: 'too_large', status: 413 };
  let text;
  try { text = await request.text(); } catch (e) { return { error: 'bad_body', status: 400 }; }
  if (new TextEncoder().encode(text).length > max) return { error: 'too_large', status: 413 };
  try { return { body: JSON.parse(text) }; } catch (e) { return { error: 'bad_json', status: 400 }; }
}

// 日本時間のきょう（YYYY-MM-DD）
export function todayJst(nowMs = Date.now()) {
  return new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
