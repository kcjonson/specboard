#!/bin/bash
set -euo pipefail

# Run an ECS task and wait for completion
# Usage: run-ecs-task.sh <task_name> <command_json> [include_superadmin_env]
#
# Required environment variables:
#   AWS_REGION, CLUSTER, TASK_DEF, SUBNETS, SECURITY_GROUP, LOG_GROUP
# Optional (when include_superadmin_env=true):
#   SUPERADMIN_PASSWORD

TASK_NAME="${1:?Task name required}"
COMMAND="${2:?Command JSON required}"
INCLUDE_SUPERADMIN_ENV="${3:-false}"

# Parse subnets into JSON array
SUBNETS_JSON=$(echo "$SUBNETS" | tr ',' '\n' | jq -R . | jq -s .)

# Build overrides JSON
if [ "$INCLUDE_SUPERADMIN_ENV" = "true" ]; then
  OVERRIDES=$(jq -n \
    --argjson cmd "$COMMAND" \
    --arg password "$SUPERADMIN_PASSWORD" \
    '{containerOverrides: [{
      name: "api",
      command: $cmd,
      environment: [
        {name: "SUPERADMIN_PASSWORD", value: $password}
      ]
    }]}')
else
  OVERRIDES=$(jq -n \
    --argjson cmd "$COMMAND" \
    '{containerOverrides: [{name: "api", command: $cmd}]}')
fi

# Run task
echo "Starting $TASK_NAME task..."
TASK_ARN=$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=${SUBNETS_JSON},securityGroups=[\"$SECURITY_GROUP\"],assignPublicIp=DISABLED}" \
  --overrides "$OVERRIDES" \
  --query 'tasks[0].taskArn' \
  --output text \
  --region "$AWS_REGION")

echo "Started $TASK_NAME task: $TASK_ARN"

# Wait for completion
echo "Waiting for $TASK_NAME to complete..."
aws ecs wait tasks-stopped \
  --cluster "$CLUSTER" \
  --tasks "$TASK_ARN" \
  --region "$AWS_REGION"

# Check exit code
EXIT_CODE=$(aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text \
  --region "$AWS_REGION")

echo "$TASK_NAME exit code: $EXIT_CODE"

if [ "$EXIT_CODE" != "0" ]; then
  echo "$TASK_NAME failed! Fetching logs..."

  TASK_ID=$(echo "$TASK_ARN" | rev | cut -d'/' -f1 | rev)

  LOG_STREAM=$(aws logs describe-log-streams \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name-prefix "api/api/${TASK_ID}" \
    --query 'logStreams[0].logStreamName' \
    --output text \
    --region "$AWS_REGION") || true

  if [ -n "$LOG_STREAM" ] && [ "$LOG_STREAM" != "None" ]; then
    echo "Log stream: $LOG_STREAM"
    aws logs get-log-events \
      --log-group-name "$LOG_GROUP" \
      --log-stream-name "$LOG_STREAM" \
      --limit 100 \
      --region "$AWS_REGION" \
      --query 'events[*].message' \
      --output text || echo "Could not fetch log events"
  else
    echo "Could not find log stream for task ${TASK_ID}"
  fi

  exit 1
fi

echo "$TASK_NAME completed successfully!"
