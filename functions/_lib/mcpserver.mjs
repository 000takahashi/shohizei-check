// MCP サーバー（Streamable HTTP・状態を持たない JSON 応答のみ）。輸入利益チェッカーの /mcp と同じ作り。
// 道具の中身（tools）はサイトごとのファイルが渡す。ここは JSON-RPC の受け答えだけ。
import { json, preflight, readJson, safeText, validate, LIMITS } from './open.mjs';

const SUPPORTED = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

function ok(id, result) { return { jsonrpc: '2.0', id, result }; }
function err(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

// JSON-RPC の id は短い文字か数だけを受け付ける（巨大な値や指示文をそのまま返さないため）
function validId(msg) {
  if (!msg || typeof msg !== 'object') return false;
  const id = msg.id;
  return (typeof id === 'number' && isFinite(id)) || (typeof id === 'string' && id.length <= 100);
}

function toolResult(data, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, isError };
}

/**
 * @param {{ serverInfo: object, instructions: string, tools: Array<{name,title,description,inputSchema,run}> }} cfg
 */
export function makeMcp(cfg) {
  const list = cfg.tools.map(({ run, ...t }) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false } }));
  const byName = Object.fromEntries(cfg.tools.map((t) => [t.name, t]));

  async function handle(msg, context) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(validId(msg) ? msg.id : null, -32600, 'Invalid Request');
    if (msg.id !== undefined && msg.id !== null && !validId(msg)) return err(null, -32600, 'Invalid Request: id must be a short string or a number.');
    if (msg.id === undefined || msg.id === null) return null; // 通知には答えない
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    switch (msg.method) {
      case 'initialize': {
        const v = SUPPORTED.includes(params.protocolVersion) ? params.protocolVersion : SUPPORTED[0];
        return ok(msg.id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: cfg.serverInfo, instructions: cfg.instructions });
      }
      case 'ping':
        return ok(msg.id, {});
      case 'tools/list':
        return ok(msg.id, { tools: list });
      case 'tools/call': {
        const tool = byName[params.name];
        if (!tool) return err(msg.id, -32602, `Unknown tool: ${safeText(params.name)}`);
        const v = validate(params.arguments === undefined ? {} : params.arguments, tool.inputSchema);
        if (v.errors) return ok(msg.id, toolResult({ error: 'invalid_input', details: v.errors }, true));
        const out = await tool.run(v.value, context);
        return ok(msg.id, toolResult(out, !!(out && out.error))); // 道具が入力を断った時は isError で返す
      }
      default:
        return err(msg.id, -32601, `Method not found: ${safeText(msg.method)}`);
    }
  }

  return async function onRequest(context) {
    const { request } = context;
    if (request.method === 'OPTIONS') return preflight();
    if (request.method !== 'POST') return json({ error: 'This MCP endpoint accepts POST (Streamable HTTP, JSON responses only).' }, 405, { Allow: 'POST, OPTIONS' });
    const read = await readJson(request);
    if (read.error) return json(err(null, read.status === 413 ? -32600 : -32700, read.status === 413 ? read.error : 'Parse error'), read.status);
    const body = read.body;
    if (Array.isArray(body)) {
      if (!body.length || body.length > LIMITS.batch) return json(err(null, -32600, `A batch must have 1 to ${LIMITS.batch} messages.`), 400);
      const out = (await Promise.all(body.map((m) => handle(m, context)))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202 });
    }
    const res = await handle(body, context);
    return res ? json(res) : new Response(null, { status: 202 });
  };
}
