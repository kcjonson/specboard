#!/bin/bash
set -euo pipefail

# Get CloudFormation stack outputs and export as environment variables
# Usage: source get-stack-outputs.sh
#
# Required environment variables:
#   AWS_REGION
#
# Exports:
#   CLUSTER, TASK_DEF, SUBNETS, SECURITY_GROUP, LOG_GROUP, ALB_DNS

OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs" \
  --output json \
  --region "$AWS_REGION")

export CLUSTER=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ClusterName") | .OutputValue')
export TASK_DEF=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiTaskDefinitionArn") | .OutputValue')
export SUBNETS=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="PrivateSubnetIds") | .OutputValue')
export SECURITY_GROUP=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiSecurityGroupId") | .OutputValue')
export LOG_GROUP=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiLogGroupName") | .OutputValue')
export ALB_DNS=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AlbDnsName") | .OutputValue')

# Validate required outputs
MISSING=""
[ -z "$CLUSTER" ] && MISSING="$MISSING CLUSTER"
[ -z "$TASK_DEF" ] && MISSING="$MISSING TASK_DEF"
[ -z "$SUBNETS" ] && MISSING="$MISSING SUBNETS"
[ -z "$SECURITY_GROUP" ] && MISSING="$MISSING SECURITY_GROUP"
[ -z "$LOG_GROUP" ] && MISSING="$MISSING LOG_GROUP"
[ -z "$ALB_DNS" ] && MISSING="$MISSING ALB_DNS"

if [ -n "$MISSING" ]; then
  echo "ERROR: Missing required stack outputs:$MISSING"
  echo "Ensure DocPlatformStack is deployed and outputs are configured correctly."
  exit 1
fi

echo "Stack outputs loaded:"
echo "  CLUSTER=$CLUSTER"
echo "  TASK_DEF=$TASK_DEF"
echo "  SUBNETS=$SUBNETS"
echo "  ALB_DNS=$ALB_DNS"
