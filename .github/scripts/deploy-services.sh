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

  # Update service to use the new task definition
  aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" \
    --task-definition "$NEW_ARN" --force-new-deployment \
    --region "$AWS_REGION" --no-cli-pager

  echo "  Updated $SERVICE"
}

# Deploy core services
for SERVICE in api frontend mcp; do
  echo "Deploying $SERVICE..."
  deploy_service "$SERVICE"
done

# Storage service (only deploy if service exists and has desired count > 0)
STORAGE_STATUS=$(aws ecs describe-services --cluster "$CLUSTER" --services storage \
  --region "$AWS_REGION" --query 'services[0].status' --output text 2>/dev/null || echo "MISSING")
if [ "$STORAGE_STATUS" = "ACTIVE" ]; then
  STORAGE_DESIRED=$(aws ecs describe-services --cluster "$CLUSTER" --services storage \
    --region "$AWS_REGION" --query 'services[0].desiredCount' --output text)
  if [ "$STORAGE_DESIRED" -gt 0 ]; then
    echo "Deploying storage..."
    deploy_service "storage"
  else
    echo "Storage service exists but desiredCount=0, skipping"
  fi
else
  echo "Storage service not found, skipping"
fi

# Build list of services to wait for
SERVICES_TO_WAIT="api frontend mcp"
if [ "$STORAGE_STATUS" = "ACTIVE" ] && [ "${STORAGE_DESIRED:-0}" -gt 0 ]; then
  SERVICES_TO_WAIT="$SERVICES_TO_WAIT storage"
fi

echo "Waiting for services to stabilize..."
# services-stable waiter polls every 15s for 40 attempts (10 min).
# Rolling updates with deregistration delay can exceed this, so retry once.
if ! aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services $SERVICES_TO_WAIT \
  --region "$AWS_REGION" 2>/dev/null; then
  echo "First wait timed out, retrying (old deployments may still be draining)..."
  aws ecs wait services-stable \
    --cluster "$CLUSTER" \
    --services $SERVICES_TO_WAIT \
    --region "$AWS_REGION"
fi

echo "Deployed to: http://$ALB_DNS"
