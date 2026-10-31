#!/usr/bin/env bash
# Applies Scuby's New Relic dashboard and alerts (README.md). The User API key goes from the Keychain
# into this process's environment only; the plan file is deleted on exit.
set -euo pipefail
cd "$(dirname "$0")"
NEW_RELIC_API_KEY="$(perl -e 'alarm 20; exec @ARGV' security find-generic-password -s scuby-newrelic-user-api-key -w)"
export NEW_RELIC_API_KEY
trap 'rm -f obs.tfplan' EXIT
terraform fmt -check -diff
terraform init -input=false
terraform validate
terraform plan -input=false -out=obs.tfplan "$@"
terraform apply -input=false obs.tfplan
terraform output
