#!/usr/bin/env bash
# Builds the deployable bundle: static Next export as client assets and the
# esbuild-bundled worker as the server entry.
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$project/dist"
mkdir -p "$project/dist/server" "$project/dist/client" "$project/dist/.openai"
cp -R "$project/apps/web/out"/. "$project/dist/client"/
node "$project/scripts/bundle-worker.mjs" "$project/dist/server/index.js"
cp "$project/.openai/hosting.json" "$project/dist/.openai/hosting.json"
if [ -d "$project/.openai/drizzle" ]; then
  cp -R "$project/.openai/drizzle" "$project/dist/.openai/drizzle"
fi
echo "dist ready: $(du -sh "$project/dist" | cut -f1)"
