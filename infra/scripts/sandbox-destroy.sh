#!/usr/bin/env bash
# Destroys the sandbox and proves nothing is left. Safe to re-run (e.g. after logging in again).
set -uo pipefail
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TF="terraform -chdir=$REPO/infra/terraform/envs/sandbox"
[ -f "$REPO/infra/lambda/media/dist/media-lambdas.zip" ] || "$REPO/infra/lambda/media/build.sh"
$TF destroy -auto-approve -input=false -lock-timeout=30m || $TF destroy -auto-approve -input=false -lock-timeout=30m
bash "$REPO/infra/scripts/sweep.sh"
