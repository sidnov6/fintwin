#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$project/dist/server" "$project/dist/client" "$project/dist/.openai"
find "$project/dist" -mindepth 1 -delete
mkdir -p "$project/dist/server" "$project/dist/client" "$project/dist/.openai"
cp -R "$project/apps/web/out"/. "$project/dist/client"/
cp "$project/sites-worker/index.js" "$project/dist/server/index.js"
cp "$project/.openai/hosting.json" "$project/dist/.openai/hosting.json"
if [ -d "$project/.openai/drizzle" ]; then
  cp -R "$project/.openai/drizzle" "$project/dist/.openai/drizzle"
fi
