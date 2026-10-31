#!/usr/bin/env bash
# Packages both handlers with sharp's linux-arm64 binaries → dist/media-lambdas.zip.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf build dist
mkdir -p build dist
cp package.json package-lock.json ingest.mjs transform.mjs build/
cp -R lib build/
(cd build && npm ci --omit=dev --os=linux --cpu=arm64 --libc=glibc --no-audit --no-fund)
(cd build && zip -qr ../dist/media-lambdas.zip .)
echo "built $(pwd)/dist/media-lambdas.zip"
