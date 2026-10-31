#!/usr/bin/env bash
# Runs one NRQL query against Scuby's New Relic account through NerdGraph and prints the results JSON.
# Usage: bash infra/scripts/nr-query.sh "SELECT count(*) FROM Span WHERE service.name = 'scuby-backend' SINCE 30 minutes ago"
# The User API key comes from the macOS Keychain and reaches curl through stdin, never through argv.
set -euo pipefail
ACCOUNT_ID=8675334
NRQL=${1:?usage: nr-query.sh "<NRQL>"}

KEY="$(perl -e 'alarm 20; exec @ARGV' security find-generic-password -s scuby-newrelic-user-api-key -w)"
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT
chmod 600 "$BODY"
python3 -I -c '
import json, sys
query = "query($account: Int!, $nrql: Nrql!) { actor { account(id: $account) { nrql(query: $nrql) { results } } } }"
json.dump({"query": query, "variables": {"account": int(sys.argv[1]), "nrql": sys.argv[2]}}, open(sys.argv[3], "w"))
' "$ACCOUNT_ID" "$NRQL" "$BODY"

printf 'header = "API-Key: %s"\n' "$KEY" \
  | curl -sS --fail-with-body -K - https://api.newrelic.com/graphql \
      -H 'Content-Type: application/json' --data-binary @"$BODY" \
  | python3 -I -c '
import json, sys
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except ValueError:
    sys.stderr.write(raw[:2000] + "\n")
    sys.exit(2)
e = d.get("errors")
print(json.dumps(e if e else d["data"]["actor"]["account"]["nrql"]["results"], indent=1))
sys.exit(1 if e else 0)'
