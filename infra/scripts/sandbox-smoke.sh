#!/usr/bin/env bash
# End-to-end checks against the applied sandbox. Prints PASS/FAIL per check; exit 1 if any fails.
set -uo pipefail
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TF="terraform -chdir=$REPO/infra/terraform/envs/sandbox"
out() { $TF output -raw "$1"; }
failed=0
check() { if [ "$2" -eq 0 ]; then echo "PASS $1"; else echo "FAIL $1"; failed=1; fi; }

API=$(out api_url); ORIGIN=$(out origin_public_dns); QUEUE=$(out queue_url)
BUCKET=$(out media_bucket); IMAGES=$(out image_url)

body=$(curl -s --max-time 20 "$API/actuator/health"); echo "$body" | grep -q '"status":"UP"'
check "API health through CloudFront ($API)" $?

curl -s --max-time 8 "http://$ORIGIN:8080/actuator/health" >/dev/null
[ $? -ne 0 ]; check "the EC2 refuses direct requests" $?

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API/no/such/route")
[ "$code" = "404" ]; check "unknown route answers 404 through CloudFront (got $code)" $?

token="smoke-$(date +%s)"
aws sqs send-message --queue-url "$QUEUE" --message-body "$token" >/dev/null
msg=$(aws sqs receive-message --queue-url "$QUEUE" --wait-time-seconds 10 --query 'Messages[0].[Body,ReceiptHandle]' --output text)
[ "$(echo "$msg" | cut -f1)" = "$token" ]; check "SQS round trip" $?
[ -n "$(echo "$msg" | cut -f2)" ] && aws sqs delete-message --queue-url "$QUEUE" --receipt-handle "$(echo "$msg" | cut -f2)"

(cd "$REPO/infra/lambda/media" && node smoke/upload-smoke.mjs "$BUCKET" "$IMAGES")
check "media pipeline (see lines above)" $?

# The instance role, not the laptop's admin credentials: SQS and an upload into incoming/.
INSTANCE=$(out instance_id)
REMOTE="set -e
aws sqs send-message --region us-east-1 --queue-url $QUEUE --message-body from-instance >/dev/null
aws sqs receive-message --region us-east-1 --queue-url $QUEUE --wait-time-seconds 10 --query 'Messages[0].Body' --output text
head -c 1024 /dev/urandom > /tmp/probe.bin
aws s3api put-object --region us-east-1 --bucket $BUCKET --key incoming/probe-not-a-hash --body /tmp/probe.bin --checksum-algorithm SHA256 >/dev/null
echo instance-ok"
B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $B64 | base64 -d | bash\"]" --query Command.CommandId --output text)
st=Pending
for _ in $(seq 1 30); do
  st=$(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 4
done
outp=$(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query StandardOutputContent --output text)
[ "$st" = "Success" ] && echo "$outp" | grep -q instance-ok
check "instance role: SQS send/receive and PUT into incoming/ (status $st)" $?

[ "$failed" -eq 0 ] && echo "smoke: all passed"
exit "$failed"
