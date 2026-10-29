#!/usr/bin/env bash
# Destroys the sandbox and proves nothing is left. Safe to re-run (e.g. after logging in again).
set -uo pipefail
# launchd (watchdog) gives only /usr/bin:/bin:/usr/sbin:/sbin; terraform and aws live in ~/.local/bin.
if [ -z "${HOME:-}" ]; then
  HOME=$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')
  export HOME
fi
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || { echo "FATAL: cannot determine HOME" >&2; exit 1; }
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TF="terraform -chdir=$REPO/infra/terraform/envs/sandbox"
[ -f "$REPO/infra/lambda/media/dist/media-lambdas.zip" ] || "$REPO/infra/lambda/media/build.sh"
$TF destroy -auto-approve -input=false -lock-timeout=30m || $TF destroy -auto-approve -input=false -lock-timeout=30m
bash "$REPO/infra/scripts/sweep.sh"
