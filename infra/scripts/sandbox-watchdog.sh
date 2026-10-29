#!/usr/bin/env bash
# Usage: sandbox-watchdog.sh <deadline-epoch-seconds>
# Launched detached by the controller (launchctl submit -l co.scuby.watchdog ...). Waits for the
# wall-clock deadline, then destroys the sandbox unless Terraform state is provably empty.
#
# After launching, the controller checks "$SCRATCH/watchdog.log" (start line, deadline,
# terraform/aws paths) before applying.
#
# Safety properties:
#  - PATH is extended: launchd gives only /usr/bin:/bin:/usr/sbin:/sbin.
#  - Fail closed: destroy runs unless `terraform state list` exits 0 AND prints nothing.
#  - Fires once: every exit removes the launchd job first, so launchd relaunches it only after
#    an abnormal kill. Marker $SCRATCH/watchdog.fired (content = the deadline) is written before
#    the destroy; a relaunch that finds it still re-checks the state and destroys again unless it
#    is provably empty (the kill may have hit mid-destroy). A marker with another deadline is stale.
#  - The last action is always `launchctl remove co.scuby.watchdog` (tolerates absence).
#  - Test hook: SCUBY_WATCHDOG_DESTROY_CMD replaces the real destroy command.
set -uo pipefail

if [ -z "${HOME:-}" ]; then
  HOME=$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')
  export HOME
fi
if [ -z "${HOME:-}" ] || [ ! -d "$HOME" ]; then
  echo "watchdog: WARNING cannot determine HOME — terraform/aws will likely be missing; continuing (fail closed)"
fi
export PATH="${HOME:-/nonexistent}/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad"
MARKER="$SCRATCH/watchdog.fired"
JOB="co.scuby.watchdog"
TFDIR="$REPO/infra/terraform/envs/sandbox"

remove_job() { launchctl remove "$JOB" >/dev/null 2>&1 || echo "watchdog: launchctl remove $JOB: no such job or failed (ok)"; }

deadline="${1:-}"
echo "watchdog: start $(date -u '+%Y-%m-%dT%H:%M:%SZ') pid $$ arg='$deadline'"

if ! [[ $deadline =~ ^[0-9]+$ ]]; then
  echo "watchdog: ERROR invalid deadline '$deadline' (need epoch seconds) — NOT destroying; removing job"
  remove_job
  exit 1
fi
echo "watchdog: deadline $deadline = $(date -u -r "$deadline" '+%Y-%m-%dT%H:%M:%SZ')"
for tool in terraform aws node; do
  p=$(command -v "$tool") && echo "watchdog: $tool = $p" || echo "watchdog: $tool = MISSING"
done
command -v terraform >/dev/null 2>&1 && command -v aws >/dev/null 2>&1 || \
  echo "watchdog: WARNING terraform and/or aws MISSING from PATH — the destroy will probably fail; fix the PATH"

if [ -e "$MARKER" ]; then
  mtime=$(stat -f %m "$MARKER" 2>/dev/null || echo "?")
  if [ "$(cat "$MARKER" 2>/dev/null)" = "$deadline" ]; then
    echo "watchdog: marker $MARKER exists for this deadline (mtime $mtime) — relaunched after firing; re-checking the state"
  else
    echo "watchdog: stale marker from an earlier run (mtime $mtime, content '$(cat "$MARKER" 2>/dev/null)') — ignoring"
  fi
fi

# Wall-clock wait: immune to the Mac sleeping through a single long sleep.
while [ "$(date -u +%s)" -lt "$deadline" ]; do
  left=$(( deadline - $(date -u +%s) ))
  [ "$left" -gt 60 ] && left=60
  [ "$left" -gt 0 ] && sleep "$left"
done
echo "watchdog: deadline reached $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Fail closed: only "exit 0 and empty output" counts as an empty state.
state_out=$(terraform -chdir="$TFDIR" state list); state_rc=$?
if [ "$state_rc" -eq 0 ] && [ -z "$state_out" ]; then
  echo "watchdog: state verified empty (state list exit 0, no output) — nothing to do"
  remove_job
  exit 0
fi
echo "watchdog: state list exit=$state_rc, $(printf '%s' "$state_out" | grep -c .) resource line(s) — destroying (fail closed)"

mkdir -p "$SCRATCH" && printf '%s' "$deadline" > "$MARKER" || echo "watchdog: WARNING could not write marker $MARKER"
if [ -n "${SCUBY_WATCHDOG_DESTROY_CMD:-}" ]; then
  bash -c "$SCUBY_WATCHDOG_DESTROY_CMD"
else
  bash "$REPO/infra/scripts/sandbox-destroy.sh"
fi
echo "watchdog: destroy finished exit=$? at $(date -u '+%Y-%m-%dT%H:%M:%SZ') — removing job"
remove_job
exit 0
