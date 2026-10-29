#!/usr/bin/env bash
# Lists anything this project left in the sandbox account. Exit 1 if anything is found OR if any
# check could not run (fail closed). Pre-existing, not ours, must survive: default VPC
# vpc-9d15b4e0, bucket wc2026-tfstate-itslauyalejo.
set -uo pipefail
# launchd (watchdog) gives only /usr/bin:/bin:/usr/sbin:/sbin; terraform and aws live in ~/.local/bin.
if [ -z "${HOME:-}" ]; then
  HOME=$(/usr/bin/dscl . -read "/Users/$(/usr/bin/id -un)" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')
  export HOME
fi
[ -n "${HOME:-}" ] && [ -d "$HOME" ] || { echo "FATAL: cannot determine HOME" >&2; exit 1; }
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
found=0

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "SWEEP ERROR: credentials expired or invalid — run 'aws sso login --profile itslauyalejo-sso' and re-run"
  exit 2
fi

# check <label> <aws args...>: runs the query; an error is a failure, any output is a leftover.
check() {
  local label=$1; shift
  local out
  if ! out=$(aws "$@" 2>&1); then
    echo "SWEEP ERROR: $label — $out"; found=1; return
  fi
  if [ -n "$out" ] && [ "$out" != "None" ]; then echo "LEFTOVER $label: $out"; found=1; fi
}

check "tagged resources" resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=scuby \
  --query 'ResourceTagMappingList[].ResourceARN' --output text
check "ec2 instances" ec2 describe-instances --filters Name=tag:Project,Values=scuby \
  Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text
check "ebs volumes" ec2 describe-volumes --filters Name=tag:Project,Values=scuby --query 'Volumes[].VolumeId' --output text
check "ebs snapshots" ec2 describe-snapshots --owner-ids self --filters Name=tag:Project,Values=scuby --query 'Snapshots[].SnapshotId' --output text
check "vpcs" ec2 describe-vpcs --filters Name=tag:Project,Values=scuby --query 'Vpcs[].VpcId' --output text
check "s3 buckets" s3api list-buckets --query "Buckets[?starts_with(Name, 'scuby-')].Name" --output text
check "ecr repositories" ecr describe-repositories --query "repositories[?starts_with(repositoryName, 'scuby-')].repositoryName" --output text
check "lambda functions" lambda list-functions --query "Functions[?starts_with(FunctionName, 'scuby-')].FunctionName" --output text
check "log groups" logs describe-log-groups --log-group-name-prefix /aws/lambda/scuby- --query 'logGroups[].logGroupName' --output text
check "sqs queues" sqs list-queues --queue-name-prefix scuby- --query 'QueueUrls' --output text
check "ssm parameters" ssm get-parameters-by-path --path /scuby --recursive --query 'Parameters[].Name' --output text
check "cloudfront distributions" cloudfront list-distributions --query "DistributionList.Items[?starts_with(Comment, 'scuby')].Id" --output text
check "cloudfront origin access controls" cloudfront list-origin-access-controls --query "OriginAccessControlList.Items[?starts_with(Name, 'scuby')].Id" --output text
check "cloudfront cache policies" cloudfront list-cache-policies --type custom --query "CachePolicyList.Items[?starts_with(CachePolicy.CachePolicyConfig.Name, 'scuby')].CachePolicy.Id" --output text
check "iam roles" iam list-roles --query "Roles[?starts_with(RoleName, 'scuby-')].RoleName" --output text
check "iam instance profiles" iam list-instance-profiles --query "InstanceProfiles[?starts_with(InstanceProfileName, 'scuby-')].InstanceProfileName" --output text
check "dlm policies" dlm get-lifecycle-policies --query "Policies[?starts_with(Description, 'scuby')].PolicyId" --output text

# OIDC providers have no name to filter on: only ours carries Project=scuby.
if ! arns=$(aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text 2>&1); then
  echo "SWEEP ERROR: oidc providers — $arns"; found=1
else
  for arn in $arns; do
    if ! n=$(aws iam list-open-id-connect-provider-tags --open-id-connect-provider-arn "$arn" \
         --query "Tags[?Key=='Project' && Value=='scuby'] | length(@)" --output text 2>&1); then
      echo "SWEEP ERROR: oidc provider tags $arn — $n"; found=1
    elif [ "$n" = "1" ]; then
      echo "LEFTOVER oidc provider: $arn"; found=1
    fi
  done
fi

# The pre-existing resources must still be there.
aws ec2 describe-vpcs --vpc-ids vpc-9d15b4e0 >/dev/null 2>&1 || { echo "MISSING pre-existing default VPC vpc-9d15b4e0"; found=1; }
aws s3api head-bucket --bucket wc2026-tfstate-itslauyalejo >/dev/null 2>&1 || { echo "MISSING pre-existing bucket wc2026-tfstate-itslauyalejo"; found=1; }

[ "$found" -eq 0 ] && echo "sweep: clean"
exit "$found"
