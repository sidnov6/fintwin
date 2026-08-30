#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$project/dist/server" "$project/dist/client"
find "$project/dist" -mindepth 1 -delete
mkdir -p "$project/dist/server" "$project/dist/client"
cp -R "$project/apps/web/out"/. "$project/dist/client"/
cp "$project/sites-worker/index.js" "$project/dist/server/index.js"
