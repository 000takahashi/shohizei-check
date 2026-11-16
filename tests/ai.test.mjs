// AI 向けの窓口（/mcp と鍵なしの /api/v1/*）のテスト（node --test）
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { TOOL, TOOLS } from '../functions/_lib/tools.mjs';
import { validate } from '../functions/_lib/open.mjs';
import S from '../site/calc.js';

const env = { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
const call = (path, init) => worker.fetch(new Request('https://shohizei-check.com' + path, init), env);
const rpc = (body) => call('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const SAMPLE = { preset: 'restaurant', eatIn: 30000000, foodSales: 8000000, foodBuy: 9000000, otherBuy: 6000000, baseSales: 38000000, current: 'general' };

test('MCP: initialize と tools/list（無料の道具3つだけ。有料の計算は出さない）', async () => {
  const init = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'shohizei-check');
  const list = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.deepEqual(list.result.tools.map((t) => t.name), ['compare_tax_methods', 'get_filing_period', 'compare_normal_year']);
  list.result.tools.forEach((t) => { assert.equal(t.run, undefined); assert.equal(t.annotations.readOnlyHint, true); assert.match(t.description, /税理士または税務署/); });
});

test('MCP: 道具の結果は、画面の無料の試算（compare・steps）と同じ数字', async () => {
  const res = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'compare_tax_methods', arguments: SAMPLE } })).json();
  const r = res.result.structuredContent;
  assert.equal(res.result.isError, false);
  const pr = S.period('individual', 3);
  const c = S.compare({ ...SAMPLE, foodKubun: 3, eatInKubun: 4, otherKubun: 4, share: S.cutMonths(pr.start, pr.end) / 12 });
  assert.equal(r.best.key, c.bestKey);
  assert.equal(r.best.taxYen, Math.round(c.bestTax));
  assert.equal(r.saveBySwitchYen, Math.round(c.saveBySwitch));
  assert.deepEqual(r.taxablePeriod, { start: '2027-01-01', end: '2027-12-31', monthsAt1Percent: 9 });
  assert.equal(r.filing.form, '簡易課税制度選択届出書');
  assert.equal(r.filing.deadline, '2026-12-31');
  assert.match(r.disclaimer, /目安/);
});

test('MCP: おかしな入力は、直さずに断る（知らない項目・範囲外・空）', async () => {
  const bad = await (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'compare_tax_methods', arguments: { foodsales: 1, eatIn: -1, foodKubun: 7 } } })).json();
  assert.equal(bad.result.isError, true);
  assert.equal(bad.result.structuredContent.details.length, 3);
  const blank = TOOL.compare_tax_methods.run({});
  assert.equal(blank.error, 'no_amounts');
  // 道具が断った時も、MCP は isError、API は 400（成功と見分けられるように）
  const empty = await (await rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'compare_tax_methods', arguments: {} } })).json();
  assert.equal(empty.result.isError, true);
  assert.equal(empty.result.structuredContent.error, 'no_amounts');
  assert.equal((await call('/api/v1/compare', { method: 'POST', body: '{}' })).status, 400);
  const unk = await (await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'plan<script>' } })).json();
  assert.equal(unk.error.message, 'Unknown tool: planscript');
  const nf = await (await rpc({ jsonrpc: '2.0', id: 6, method: 'nope' })).json();
  assert.equal(nf.error.code, -32601);
});

test('MCP: 通知は202、一括は10件まで、GET は405、大きすぎる本文は413', async () => {
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const batch = await (await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'ping' }])).json();
  assert.equal(batch.length, 2);
  assert.equal((await rpc(Array.from({ length: 11 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })))).status, 400);
  assert.equal((await call('/mcp')).status, 405);
  assert.equal((await call('/mcp', { method: 'POST', body: 'x'.repeat(20000) })).status, 413);
  const opt = await call('/mcp', { method: 'OPTIONS' });
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('Access-Control-Allow-Origin'), '*');
});

test('API: GET の説明・クエリ・POST が同じ道具を呼ぶ', async () => {
  const info = await (await call('/api/v1/compare')).json();
  assert.equal(info.name, 'compare_tax_methods');
  assert.ok(info.inputSchema.properties.foodSales);
  const q = new URLSearchParams(Object.entries(SAMPLE)).toString();
  const g = await (await call('/api/v1/compare?' + q)).json();
  const p = await (await call('/api/v1/compare', { method: 'POST', body: JSON.stringify(SAMPLE) })).json();
  assert.deepEqual(g, p);
  assert.equal(p.best.key, 'simple');
  const per = await (await call('/api/v1/period?who=corporate&endMonth=3')).json();
  assert.deepEqual(per.taxablePeriod, { start: '2027-04-01', end: '2028-03-31', monthsAt1Percent: 12 });
  const ny = await (await call('/api/v1/normal-year', { method: 'POST', body: JSON.stringify({ foodSales: 8000000, foodBuy: 5000000, baseSales: 9000000 }) })).json();
  assert.equal(ny.foodRatePercent, 8);
  assert.equal(ny.best.key, 'exempt');
  const bad = await call('/api/v1/compare?endMonth=13');
  assert.equal(bad.status, 400);
});

test('有料の窓口は今までどおり（鍵なしの道具からは呼べない）', async () => {
  assert.ok(!TOOLS.some((t) => /plan|pricing/.test(t.name)));
  const r = await call('/api/v1/plan', { method: 'POST', body: JSON.stringify({ foodSales: 1 }) });
  assert.ok([200, 402].includes(r.status)); // 無料開放の間は200、それ以外はパスが無いので402
});

test('validate: クエリの文字を数と真偽に直す', () => {
  const schema = { properties: { a: { type: 'number' }, b: { type: 'boolean' }, c: { type: 'integer', minimum: 1, maximum: 12 } } };
  assert.deepEqual(validate({ a: '1.5', b: 'true', c: '3' }, schema, true).value, { a: 1.5, b: true, c: 3 });
  assert.ok(validate({ a: 'x' }, schema, true).errors);
  assert.ok(validate({ c: 2.5 }, schema).errors);
  assert.ok(validate([], schema).errors);
});

test('税込みで入れると、画面の「税込」と同じく税抜きに戻してから計算する', () => {
  const incl = TOOL.compare_tax_methods.run({ ...SAMPLE, amountsIncludeTax: true, eatIn: 33000000, foodSales: 8640000, foodBuy: 9720000, otherBuy: 6600000 });
  const excl = TOOL.compare_tax_methods.run(SAMPLE);
  assert.equal(incl.best.taxYen, excl.best.taxYen);
  assert.equal(incl.saveBySwitchYen, excl.saveBySwitchYen);
});
