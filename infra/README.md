# Infrastructure

AWS CDK infrastructure for doc-platform staging environment.

## Architecture

- **ECS Fargate** - Runs api, frontend, and mcp containers
- **RDS PostgreSQL** - Database (single-AZ for staging)
- **ElastiCache Redis** - Session storage
- **ALB** - Load balancer with path-based routing
- **ECR** - Container image registry

## Deployment Model

The CD workflow (`cd.yml`) handles both code and infrastructure:
1. Builds and pushes Docker images to ECR
2. Runs database migrations
3. Runs `cdk deploy` (applies any infrastructure changes)
4. Forces ECS to pull new images

| Change Type | How to Deploy |
|-------------|---------------|
| Code changes | Push to main → CD workflow runs automatically |
| Infrastructure changes | Push to main → CD workflow runs automatically |
| Manual deploy | `gh workflow run cd.yml` |

### Adding a New Service

ECR repos use `RETAIN` policy so they survive failed deployments. For a new service:

1. First CD run: Creates ECR repo, service fails (no image), rollback - but repo survives
2. Second CD run: Pushes image to existing repo, deployment succeeds

Re-run via: `gh workflow run cd.yml` or push another commit.

### Image Lifecycle

ECR lifecycle policies automatically delete old images:
- Keeps last 3 images per repo (current + 2 for rollback)
- Older images are automatically deleted

## Local Deployment

### Prerequisites

```bash
# AWS CLI configured with appropriate credentials
aws sts get-caller-identity

# Docker running
docker info

# Dependencies installed (run inside container)
docker compose run --rm api npm install
```

### Full Deployment

```bash
# Set variables
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=us-west-2
ECR_BASE=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/doc-platform

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | \
  docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build and push images
docker build -f api/Dockerfile -t $ECR_BASE/api:latest . && docker push $ECR_BASE/api:latest
docker build -f frontend/Dockerfile -t $ECR_BASE/frontend:latest . && docker push $ECR_BASE/frontend:latest
docker build -f mcp/Dockerfile -t $ECR_BASE/mcp:latest . && docker push $ECR_BASE/mcp:latest

# Deploy infrastructure and services
cd infra && npx cdk deploy --require-approval never
```

### Run Migrations Manually

```bash
CLUSTER=$(aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" --output text --region us-west-2)
TASK_DEF=$(aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiTaskDefinitionArn'].OutputValue" --output text --region us-west-2)
SUBNETS=$(aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs[?OutputKey=='PrivateSubnetIds'].OutputValue" --output text --region us-west-2)
SG=$(aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiSecurityGroupId'].OutputValue" --output text --region us-west-2)
SUBNETS_JSON=$(echo $SUBNETS | tr ',' '\n' | jq -R . | jq -s .)

aws ecs run-task \
  --cluster $CLUSTER \
  --task-definition $TASK_DEF \
  --launch-type FARGATE \
  --network-configuration "{\"awsvpcConfiguration\":{\"subnets\":$SUBNETS_JSON,\"securityGroups\":[\"$SG\"],\"assignPublicIp\":\"DISABLED\"}}" \
  --overrides '{"containerOverrides":[{"name":"api","command":["node","shared/db/dist/migrate.js"]}]}' \
  --region us-west-2
```

### Monitor Deployment

```bash
CLUSTER=$(aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" --output text --region us-west-2)

# Service status
aws ecs describe-services --cluster $CLUSTER --services api frontend mcp \
  --query "services[*].[serviceName,runningCount,desiredCount,deployments[0].rolloutState]" \
  --output table --region us-west-2

# ALB URL
aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" --output text --region us-west-2
```

## CDK Commands

```bash
cd infra

# Preview changes
npx cdk diff

# Deploy
npx cdk deploy --require-approval never

# Output CloudFormation template
npx cdk synth

# Destroy (careful!)
npx cdk destroy
```

## Troubleshooting

### Services not starting

Check ECS service events:
```bash
aws ecs describe-services --cluster $CLUSTER --services api \
  --query "services[0].events[:5]"
```

Check container logs:
```bash
LOG_GROUP=$(aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiLogGroupName'].OutputValue" --output text)

aws logs tail $LOG_GROUP --follow
```

### Circuit breaker triggered

Services have circuit breakers enabled. If containers fail repeatedly, deployment will roll back automatically. Check logs for the root cause.

### CloudFormation stuck

If a deployment gets stuck:
```bash
# Check stack status
aws cloudformation describe-stacks --stack-name DocPlatformStack \
  --query "Stacks[0].StackStatus"

# Cancel update (if UPDATE_IN_PROGRESS)
aws cloudformation cancel-update-stack --stack-name DocPlatformStack

# Scale services to 0 if needed
aws ecs update-service --cluster $CLUSTER --service api --desired-count 0
aws ecs update-service --cluster $CLUSTER --service frontend --desired-count 0
aws ecs update-service --cluster $CLUSTER --service mcp --desired-count 0
```
