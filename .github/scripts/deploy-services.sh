#!/bin/bash
set -euo pipefail

# Deploy all ECS services with a specific image tag.
#
# For each service, registers a new task definition revision with the pinned
# image tag, then updates the service to use it. This ensures the exact image
# (identified by SHA) is deployed, regardless of what :latest or :init points to.
#
# Usage: deploy-services.sh <image-tag>
#
# Required environment variables:
#   AWS_REGION, CLUSTER, ALB_DNS

IMAGE_TAG="${1:?Usage: deploy-services.sh <image-tag>}"

echo "Deploying services with image tag: $IMAGE_TAG"

declare -A REGISTERED_ARNS

deploy_service() {
  local SERVICE=$1
  local TMPFILE
  TMPFILE=$(mktemp)
  trap "rm -f $TMPFILE" RETURN

  # Get current task definition from the service
  TASK_DEF_ARN=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].taskDefinition' --output text --region "$AWS_REGION")

  # Get task definition details, strip read-only fields, and pin the image tag.
  # describe-task-definition returns fields that register-task-definition rejects,
  # so we must remove them all.
  aws ecs describe-task-definition --task-definition "$TASK_DEF_ARN" \
    --query taskDefinition --output json --region "$AWS_REGION" \
    | jq --arg TAG "$IMAGE_TAG" '
      del(.taskDefinitionArn, .revision, .status, .requiresAttributes,
          .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)
      | .containerDefinitions |= map(.image = (.image | split(":")[0] + ":" + $TAG))
    ' > "$TMPFILE"

  NEW_ARN=$(aws ecs register-task-definition \
    --cli-input-json "file://$TMPFILE" \
    --query 'taskDefinition.taskDefinitionArn' --output text --region "$AWS_REGION")

  echo "  Registered: $NEW_ARN"
  REGISTERED_ARNS["$SERVICE"]=$NEW_ARN

  # Update service to use the new task definition
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$NEW_ARN" --force-new-deployment \
    --region "$AWS_REGION" --no-cli-pager

  echo "  Updated $SERVICE"
}

# services-stable polls every 15s for 40 attempts (10 min). Rolling updates with
# deregistration delay can exceed this, so retry once.
wait_stable() {
  if ! aws ecs wait services-stable --cluster "$CLUSTER" --services "$@" --region "$AWS_REGION"; then
    echo "First wait failed; retrying once (services may still be draining)..."
    aws ecs wait services-stable --cluster "$CLUSTER" --services "$@" --region "$AWS_REGION"
  fi
}

# Storage goes first and must be stable before the services that call it roll out:
# its migrations only add, so the old api runs fine against it, while a new api
# talking to an old storage task can send fields that are silently dropped.
# (Only deployed if the service exists and has desired count > 0.)
STORAGE_STATUS=$(aws ecs describe-services --cluster "$CLUSTER" --services storage \
  --region "$AWS_REGION" --query 'services[0].status' --output text 2>/dev/null || echo "MISSING")
DEPLOY_STORAGE=false
if [ "$STORAGE_STATUS" = "ACTIVE" ]; then
  STORAGE_DESIRED=$(aws ecs describe-services --cluster "$CLUSTER" --services storage \
    --region "$AWS_REGION" --query 'services[0].desiredCount' --output text)
  if [ "$STORAGE_DESIRED" -gt 0 ]; then
    DEPLOY_STORAGE=true
  else
    echo "Storage service exists but desiredCount=0, skipping"
  fi
else
  echo "Storage service not found, skipping"
fi

if [ "$DEPLOY_STORAGE" = true ]; then
  echo "Deploying storage..."
  deploy_service "storage"
  echo "Waiting for storage to stabilize before the services that call it..."
  wait_stable storage
fi

# Deploy core services
for SERVICE in api frontend mcp; do
  echo "Deploying $SERVICE..."
  deploy_service "$SERVICE"
done

SERVICES_TO_WAIT="api frontend mcp"
if [ "$DEPLOY_STORAGE" = true ]; then
  SERVICES_TO_WAIT="$SERVICES_TO_WAIT storage"
fi

echo "Waiting for services to stabilize..."
wait_stable $SERVICES_TO_WAIT

# services-stable is also satisfied by a completed circuit-breaker rollback, so
# confirm each service actually ended up on the task definition registered above.
ROLLED_BACK=""
for SERVICE in $SERVICES_TO_WAIT; do
  CURRENT_ARN=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
    --query 'services[0].taskDefinition' --output text --region "$AWS_REGION")
  if [ "$CURRENT_ARN" != "${REGISTERED_ARNS["$SERVICE"]}" ]; then
    echo "ERROR: $SERVICE is running $CURRENT_ARN, expected ${REGISTERED_ARNS["$SERVICE"]} (deployment rolled back)"
    ROLLED_BACK="$ROLLED_BACK $SERVICE"
  fi
done
if [ -n "$ROLLED_BACK" ]; then
  echo "Deployment failed for:$ROLLED_BACK"
  exit 1
fi

echo "Deployed to: http://$ALB_DNS"
