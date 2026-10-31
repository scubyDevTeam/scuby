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
# Pinned, like the Terraform provider (envs/sandbox/variables.tf): the sandbox lives in one account.
export AWS_PROFILE=itslauyalejo-sso AWS_REGION=us-east-1
found=0

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "SWEEP ERROR: credentials expired or invalid — run 'aws sso login --profile $AWS_PROFILE' and re-run"
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

# The Resource Groups Tagging API keeps listing terminated instances and deleted volumes / security
# group rules for an hour or more after a destroy. ghost_gone <arn> returns 0 only when the EC2 API
# itself proves the resource is gone; any other ARN type or any other error returns 1 (fail closed).
ghost_gone() {
  local arn=$1 region res type id out
  region=$(printf '%s' "$arn" | cut -d: -f4)
  res=$(printf '%s' "$arn" | cut -d: -f6-)
  case "$arn" in arn:aws:ec2:*) ;; *) return 1 ;; esac
  [ -n "$region" ] || return 1
  type=${res%%/*}; id=${res#*/}
  case "$type" in
    instance)
      out=$(aws ec2 describe-instances --region "$region" --instance-ids "$id" \
        --query 'Reservations[].Instances[].State.Name' --output text 2>&1) && [ "$out" = "terminated" ] && return 0
      case "$out" in *InvalidInstanceID.NotFound*) return 0 ;; esac ;;
    volume)
      out=$(aws ec2 describe-volumes --region "$region" --volume-ids "$id" 2>&1) && return 1
      case "$out" in *InvalidVolume.NotFound*) return 0 ;; esac ;;
    security-group-rule)
      out=$(aws ec2 describe-security-group-rules --region "$region" --security-group-rule-ids "$id" 2>&1) && return 1
      case "$out" in *InvalidSecurityGroupRuleId.NotFound*) return 0 ;; esac ;;
    security-group)
      out=$(aws ec2 describe-security-groups --region "$region" --group-ids "$id" 2>&1) && return 1
      case "$out" in *InvalidGroup.NotFound* | *InvalidGroupId.NotFound*) return 0 ;; esac ;;
  esac
  return 1
}

if ! tagged=$(aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=scuby \
    --query 'ResourceTagMappingList[].ResourceARN' --output text 2>&1); then
  echo "SWEEP ERROR: tagged resources — $tagged"; found=1
else
  for arn in $tagged; do
    [ "$arn" = "None" ] && continue
    if ghost_gone "$arn"; then
      echo "ghost (tagging index lag, verified gone): $arn"
    else
      echo "LEFTOVER tagged resources: $arn"; found=1
    fi
  done
fi
check "ec2 instances" ec2 describe-instances --filters Name=tag:Project,Values=scuby \
  Name=instance-state-name,Values=pending,running,stopping,stopped --query 'Reservations[].Instances[].InstanceId' --output text
check "ebs volumes" ec2 describe-volumes --filters Name=tag:Project,Values=scuby --query 'Volumes[].VolumeId' --output text
check "ebs snapshots" ec2 describe-snapshots --owner-ids self --filters Name=tag:Project,Values=scuby --query 'Snapshots[].SnapshotId' --output text
check "vpcs" ec2 describe-vpcs --filters Name=tag:Project,Values=scuby --query 'Vpcs[].VpcId' --output text
check "s3 buckets" s3api list-buckets --query "Buckets[?starts_with(Name, 'scuby-')].Name" --output text
check "ecr repositories" ecr describe-repositories --query "repositories[?starts_with(repositoryName, 'scuby-')].repositoryName" --output text
check "lambda functions" lambda list-functions --query "Functions[?starts_with(FunctionName, 'scuby-')].FunctionName" --output text
check "log groups" logs describe-log-groups --log-group-name-prefix /aws/lambda/scuby- --query 'logGroups[].logGroupName' --output text
check "backend log groups" logs describe-log-groups --log-group-name-prefix /scuby/ --query 'logGroups[].logGroupName' --output text
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
