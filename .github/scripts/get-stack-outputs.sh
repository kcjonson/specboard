#!/bin/bash
set -euo pipefail

# Get CloudFormation stack outputs and export as environment variables
# Usage: source get-stack-outputs.sh [stack-name]
#
# Arguments:
#   stack-name  Optional. Defaults to STACK_NAME env var or 'DocPlatformStack'.
#
# Required environment variables:
#   AWS_REGION
#
# Exports:
#   CLUSTER, TASK_DEF, SUBNETS, SECURITY_GROUP, LOG_GROUP, ALB_DNS

STACK="${1:-${STACK_NAME:-DocPlatformStack}}"

OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --query "Stacks[0].Outputs" \
  --output json \
  --region "$AWS_REGION")

export CLUSTER=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ClusterName") | .OutputValue')
export TASK_DEF=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiTaskDefinitionArn") | .OutputValue')
export SUBNETS=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="PrivateSubnetIds") | .OutputValue')
export SECURITY_GROUP=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiSecurityGroupId") | .OutputValue')
export LOG_GROUP=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiLogGroupName") | .OutputValue')
export ALB_DNS=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AlbDnsName") | .OutputValue')

# Validate required outputs (jq -r returns "null" for missing keys)
is_missing() { [ -z "$1" ] || [ "$1" = "null" ]; }
MISSING=""
is_missing "$CLUSTER" && MISSING="$MISSING CLUSTER"
is_missing "$TASK_DEF" && MISSING="$MISSING TASK_DEF"
is_missing "$SUBNETS" && MISSING="$MISSING SUBNETS"
is_missing "$SECURITY_GROUP" && MISSING="$MISSING SECURITY_GROUP"
is_missing "$LOG_GROUP" && MISSING="$MISSING LOG_GROUP"
is_missing "$ALB_DNS" && MISSING="$MISSING ALB_DNS"

if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required stack outputs:$MISSING"
  echo "Ensure $STACK is deployed and outputs are configured correctly."
  exit 1
fi

echo "Stack outputs loaded ($STACK):"
echo "  CLUSTER=$CLUSTER"
echo "  TASK_DEF=$TASK_DEF"
echo "  SUBNETS=$SUBNETS"
echo "  ALB_DNS=$ALB_DNS"
