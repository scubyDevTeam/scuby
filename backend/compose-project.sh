#!/usr/bin/env bash
# Prints this checkout's compose project name: scuby-backend-<basename of the git top level>,
# lower-cased, anything but [a-z0-9_-] replaced by "-" (compose's rule for project names).
set -euo pipefail
top="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
slug="$(basename "$top" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9_\n-' '-' | sed 's/^[^a-z0-9]*//')"
[[ -n "$slug" ]] || { echo "compose-project.sh: cannot derive a project name from '$top'" >&2; exit 1; }
echo "scuby-backend-${slug}"
