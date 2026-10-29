#!/usr/bin/env bash
# Usage: sandbox-watchdog.sh <deadline-epoch-seconds>
# Sleeps until the deadline, then destroys the sandbox unless the Terraform state is already empty.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
deadline=$1
now=$(date -u +%s)
[ "$deadline" -gt "$now" ] && sleep $(( deadline - now ))
if [ -n "$(terraform -chdir="$REPO/infra/terraform/envs/sandbox" state list 2>/dev/null)" ]; then
  echo "watchdog: deadline reached with resources alive — destroying"
  bash "$REPO/infra/scripts/sandbox-destroy.sh"
else
  echo "watchdog: state already empty — nothing to do"
fi
