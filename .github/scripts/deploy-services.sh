#!/bin/bash
set -euo pipefail

# Force new deployment on all ECS services and wait for stabilization
# Usage: deploy-services.sh
#
# Why force deployment after CDK deploy?
# CDK updates task definitions with new image tags, but ECS may cache the :latest
# image. --force-new-deployment ensures containers pull fresh images even if the
# tag (latest) hasn't changed. This runs after deploy-infra completes.
#
# Required environment variables:
#   AWS_REGION, CLUSTER, ALB_DNS

echo "Forcing new deployment on all services..."

aws ecs update-service --cluster "$CLUSTER" --service api --force-new-deployment --region "$AWS_REGION" --no-cli-pager
aws ecs update-service --cluster "$CLUSTER" --service frontend --force-new-deployment --region "$AWS_REGION" --no-cli-pager
aws ecs update-service --cluster "$CLUSTER" --service mcp --force-new-deployment --region "$AWS_REGION" --no-cli-pager

# Storage service (only deploy if service exists and has desired count > 0)
STORAGE_STATUS=$(aws ecs describe-services --cluster "$CLUSTER" --services storage --region "$AWS_REGION" --query 'services[0].status' --output text 2>/dev/null || echo "MISSING")
if [ "$STORAGE_STATUS" = "ACTIVE" ]; then
  STORAGE_DESIRED=$(aws ecs describe-services --cluster "$CLUSTER" --services storage --region "$AWS_REGION" --query 'services[0].desiredCount' --output text)
  if [ "$STORAGE_DESIRED" -gt 0 ]; then
    echo "Deploying storage service..."
    aws ecs update-service --cluster "$CLUSTER" --service storage --force-new-deployment --region "$AWS_REGION" --no-cli-pager
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

echo "Waiting for services to stabilize (up to 10 minutes)..."
aws ecs wait services-stable \
  --cluster "$CLUSTER" \
  --services $SERVICES_TO_WAIT \
  --region "$AWS_REGION"

echo "Deployed to: http://$ALB_DNS"
