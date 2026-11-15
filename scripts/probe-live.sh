#!/usr/bin/env bash
# 本番の AI 向け窓口（MCP と /api/v1/*）を実際に呼び、やりとりをそのまま表示する。読むだけ。鍵は使わない。
set -u
B="${BASE:-https://shohizei-check.com}"
H=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'user-agent: shohizei-check-live-probe')
call() { echo; echo "===== $1 ====="; echo ">>> POST $B/mcp"; echo "$2"; echo "<<<"; curl -sS -m 30 -w '\n[HTTP %{http_code}]\n' -X POST "$B/mcp" "${H[@]}" -d "$2"; }
g() { echo; echo "===== $1 ====="; echo ">>> $2"; echo "<<<"; curl -sS -m 30 -w '\n[HTTP %{http_code}]\n' "${@:3}" "$2" | head -c 3000; echo; }
call "MCP initialize" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"live-probe","version":"1"}}}'
call "MCP tools/list" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
call "道具1 compare_tax_methods（飲食店・税抜1年分）" '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"compare_tax_methods","arguments":{"preset":"restaurant","eatIn":30000000,"foodSales":8000000,"foodBuy":9000000,"otherBuy":6000000,"baseSales":38000000,"current":"general"}}}'
call "道具2 get_filing_period（法人・3月決算）" '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_filing_period","arguments":{"who":"corporate","endMonth":3}}}'
call "道具3 compare_normal_year" '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"compare_normal_year","arguments":{"foodSales":8000000,"foodBuy":5000000,"baseSales":9000000}}}'
g "API compare（GET）" "$B/api/v1/compare?preset=restaurant&eatIn=30000000&foodSales=8000000&foodBuy=9000000&otherBuy=6000000&baseSales=38000000"
g "有料 API plan（鍵なし。11月30日までの無料開放中は200、それ以外は402のはず）" "$B/api/v1/plan" -X POST -H "content-type: application/json" -d "{\"foodSales\":1}"
g "llms.txt" "$B/llms.txt"
