// AI 向けの窓口（/mcp と鍵の要らない /api/v1/*）の共通の道具。
// 輸入利益チェッカー（yunyu-rieki）の窓口と同じ作り。よその AI やサイトから呼ばれる前提なので、CORS は開ける。
// 有料の窓口（/api/v1/pass/*・有料の計算）は今までどおり http.mjs を使い、ここは使わない。

export const LIMITS = {
  bodyBytes: 16 * 1024, // POST の本文の大きさ
  batch: 10, // MCP の一括呼び出しの件数
  text: 40, // 返す文字（道具の名前など）の長さ
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version',
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...CORS, ...extra,
    },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
}

// 相手の入力をそのまま返さない（AI への指示文を応答に混ぜ込まれないように、英数字と記号の一部だけを短く残す）
export function safeText(v, max = LIMITS.text) {
  return String(v === undefined || v === null ? '' : v).slice(0, max).replace(/[^A-Za-z0-9_.\-]/g, '');
}

// POST の JSON を、大きさの上限つきで読む。失敗は { error, status }。
export async function readJson(request, max = LIMITS.bodyBytes) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > max) return { error: `Request body is too large (max ${max} bytes).`, status: 413 };
  let text;
  try { text = await request.text(); } catch (e) { return { error: 'Could not read the request body.', status: 400 }; }
  if (new TextEncoder().encode(text).length > max) return { error: `Request body is too large (max ${max} bytes).`, status: 413 };
  try { return { body: JSON.parse(text) }; } catch (e) { return { error: 'Body must be JSON.', status: 400 }; }
}

/**
 * 入力を道具の JSON Schema で確かめる（使うのは type・minimum・maximum・enum・pattern・required・additionalProperties だけ）。
 * fromQuery が true の時は、URL のクエリの文字を数・真偽に直してから確かめる。
 * 返り値は { value } か { errors: [...] }。おかしな入力は、勝手に直さずに断る（目安の数字を間違った前提で出さないため）。
 */
export function validate(args, schema, fromQuery = false) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { errors: ['Arguments must be a JSON object.'] };
  const props = schema.properties || {};
  const errors = [];
  const value = {};
  for (const key of Object.keys(args)) {
    if (!props[key]) { errors.push(`Unknown field: ${safeText(key)}`); continue; }
    let v = args[key];
    const p = props[key];
    if (v === null || v === '') continue; // 空は「入れていない」と同じ
    if (fromQuery && typeof v === 'string') {
      if (p.type === 'number' || p.type === 'integer') v = v.trim() === '' ? NaN : Number(v);
      else if (p.type === 'boolean') v = v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v;
    }
    if (p.type === 'number' || p.type === 'integer') {
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${key} must be a number.`); continue; }
      if (p.type === 'integer' && !Number.isInteger(v)) { errors.push(`${key} must be an integer.`); continue; }
      if (p.minimum !== undefined && v < p.minimum) { errors.push(`${key} must be ${p.minimum} or more.`); continue; }
      if (p.maximum !== undefined && v > p.maximum) { errors.push(`${key} must be ${p.maximum} or less.`); continue; }
    } else if (p.type === 'boolean') {
      if (typeof v !== 'boolean') { errors.push(`${key} must be true or false.`); continue; }
    } else if (p.type === 'string') {
      if (typeof v !== 'string') { errors.push(`${key} must be a string.`); continue; }
      if (p.enum && !p.enum.includes(v)) { errors.push(`${key} must be one of: ${p.enum.join(', ')}.`); continue; }
      if (p.pattern && !new RegExp(p.pattern).test(v)) { errors.push(`${key} has the wrong format.`); continue; }
    }
    value[key] = v;
  }
  for (const key of schema.required || []) if (value[key] === undefined && !errors.some((e) => e.startsWith(key))) errors.push(`${key} is required.`);
  return errors.length ? { errors } : { value };
}

/** 道具1つを、REST の窓口（GET はクエリ、POST は JSON。引数なしの GET は入力の説明）にする。 */
export function restEndpoint(tool, extra = {}) {
  return async function onRequest(context) {
    const { request } = context;
    if (request.method === 'OPTIONS') return preflight();
    let args;
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].length === 0) {
        return json({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, mcp: `${extra.site || ''}/mcp`, ...extra.info });
      }
      args = Object.fromEntries(params);
      const v = validate(args, tool.inputSchema, true);
      if (v.errors) return json({ error: 'invalid_input', details: v.errors }, 400);
      return toolJson(await tool.run(v.value, context));
    }
    if (request.method !== 'POST') return json({ error: 'Use GET or POST.' }, 405, { Allow: 'GET, POST, OPTIONS' });
    const read = await readJson(request);
    if (read.error) return json({ error: read.error }, read.status);
    args = read.body;
    const v = validate(args, tool.inputSchema);
    if (v.errors) return json({ error: 'invalid_input', details: v.errors }, 400);
    return toolJson(await tool.run(v.value, context));
  };
}

// 道具が入力を断った時（{ error }）は 400 で返す。成功と見分けられるように
function toolJson(out) {
  return json(out, out && out.error ? 400 : 200);
}
