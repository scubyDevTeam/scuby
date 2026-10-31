#!/usr/bin/env bash
# Minutes left in the 8-hour SSO session, counted from the login time the human recorded:
#   aws sso login --profile itslauyalejo-sso && date -u +%s > "${SCUBY_SANDBOX_DIR:-$HOME/.scuby-sandbox}/sso-login"
# The cached access token refreshes hourly, so its expiresAt is not the session end.
# Prints 0 (fail closed) when the login file is missing or the credentials do not work.
set -uo pipefail
SCRATCH="${SCUBY_SANDBOX_DIR:-${HOME:?HOME is not set}/.scuby-sandbox}"
mkdir -p "$SCRATCH"
LOGIN_FILE="${SSO_LOGIN_FILE:-$SCRATCH/sso-login}"
SESSION_MINUTES="${SSO_SESSION_MINUTES:-480}"
if [ ! -s "$LOGIN_FILE" ] || ! AWS_PROFILE=itslauyalejo-sso aws sts get-caller-identity >/dev/null 2>&1; then
  echo 0
  exit 0
fi
login=$(cat "$LOGIN_FILE")
now=$(date -u +%s)
left=$(( (login + SESSION_MINUTES * 60 - now) / 60 ))
[ "$left" -lt 0 ] && left=0
echo "$left"
