#!/bin/sh
# The product name is configuration (docs/product/00 · #21): no source file may spell it.
if grep -rIni --include='*.ts' --include='*.tsx' --include='*.css' --include='*.html' --include='*.json' 'scuby' src index.html; then
  echo 'Found the product name hard-coded. Read it from src/brand.ts instead.' >&2
  exit 1
fi
