#!/bin/sh
set -e

uv run oag mcp serve --host 0.0.0.0 --port 8765 --transport streamable-http &
MCP_PID=$!

sleep 2

uv run oag serve --host 0.0.0.0 --port 8000 &
API_PID=$!

trap 'kill $MCP_PID $API_PID 2>/dev/null; wait' EXIT INT TERM

wait
