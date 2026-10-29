#!/usr/bin/env bash
# Pushes the locally built images to ECR and starts them on the sandbox EC2 through SSM.
# Run sandbox-build.sh first.
set -euo pipefail
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad"
TF="terraform -chdir=$REPO/infra/terraform/envs/sandbox"
json=$($TF output -json)
get() { python3 -I -c "import json,sys; d=json.loads(sys.argv[1]); v=d[sys.argv[2]]['value']; print(v[sys.argv[3]] if len(sys.argv) > 3 else v)" "$json" "$@"; }

BACKEND_REPO=$(get ecr_repository_urls backend)
POSTGRES_REPO=$(get ecr_repository_urls postgres)
INSTANCE=$(get instance_id)
PREFIX=$(get ssm_prefix)
LOG_GROUP=$(get backend_log_group)
REGISTRY="${BACKEND_REPO%%/*}"

echo "== push images"
aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRY"
docker tag scuby/postgres:17 "$POSTGRES_REPO:17" && docker push "$POSTGRES_REPO:17"
docker tag scuby-backend "$BACKEND_REPO:sandbox" && docker push "$BACKEND_REPO:sandbox"

echo "== database password (generated once by the CLI, kept across retries)"
# Terraform creates the parameter with the value "placeholder" and ignores later changes to it, but its
# refresh does read the real value back into the git-ignored local state. Only the CLI ever writes it.
# A retry must keep the existing value: the Postgres volume was already initialised with it.
current=$(aws ssm get-parameter --name "$PREFIX/db/password" --with-decryption \
  --query Parameter.Value --output text)
if [ "$current" = "placeholder" ]; then
  aws ssm put-parameter --name "$PREFIX/db/password" --type SecureString --overwrite \
    --value "$(openssl rand -hex 24)" >/dev/null
  echo "generated a new password"
else
  echo "password already set — reusing it"
fi
unset current

echo "== waiting for the instance to register with SSM"
status=""
for _ in $(seq 1 60); do
  status=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE" \
    --query 'InstanceInformationList[0].PingStatus' --output text)
  [ "$status" = "Online" ] && break
  sleep 10
done
[ "$status" = "Online" ] || { echo "instance never came online in SSM"; exit 1; }

echo "== start the stack on the instance"
# The remote script is shipped base64-encoded: no quoting survives JSON + SSM + bash otherwise.
REMOTE=$(cat <<EOF
set -euo pipefail
for i in \$(seq 1 60); do [ -f /opt/scuby/.bootstrapped ] && break; sleep 5; done
test -f /opt/scuby/.bootstrapped
cd /opt/scuby
echo '$(base64 < "$REPO/infra/compose/sandbox/compose.yaml" | tr -d '\n')' | base64 -d > compose.yaml
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $REGISTRY
DB=\$(aws ssm get-parameter --region us-east-1 --name $PREFIX/db/password --with-decryption --query Parameter.Value --output text)
umask 077
{ echo "BACKEND_IMAGE=$BACKEND_REPO:sandbox"; echo "POSTGRES_IMAGE=$POSTGRES_REPO:17"; echo "BACKEND_LOG_GROUP=$LOG_GROUP"; echo "DB_PASSWORD=\$DB"; } > .env
docker compose up -d
for i in \$(seq 1 90); do curl -sf localhost:8080/actuator/health && exit 0; sleep 5; done
docker compose logs --tail 100
exit 1
EOF
)
REMOTE_B64=$(printf '%s' "$REMOTE" | base64 | tr -d '\n')
printf '{"commands":["echo %s | base64 -d > /opt/scuby-run.sh", "bash /opt/scuby-run.sh"],"executionTimeout":["900"]}' "$REMOTE_B64" > "$SCRATCH/ssm-commands.json"
CMD=$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript \
  --parameters "file://$SCRATCH/ssm-commands.json" --timeout-seconds 900 \
  --query Command.CommandId --output text)
rm -f "$SCRATCH/ssm-commands.json"
st=Pending
for _ in $(seq 1 100); do
  st=$(aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || echo Pending)
  case "$st" in Success|Failed|Cancelled|TimedOut) break ;; esac
  sleep 10
done
# Print status and the tail of stdout only — never the .env or the password.
aws ssm get-command-invocation --command-id "$CMD" --instance-id "$INSTANCE" \
  --query '[Status,StandardOutputContent]' --output text | tail -20
[ "$st" = "Success" ]
