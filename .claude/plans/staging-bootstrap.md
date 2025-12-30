# Staging Bootstrap Plan

## Problem

Chicken-and-egg deployment failure:
1. CDK creates ECR repos AND ECS services together
2. ECS services fail because no images exist in ECR
3. Circuit breaker triggers → stack rolls back
4. ECR repos survive (RETAIN policy) but "resource already exists" on next deploy

## Solution: Bootstrap Mode with `desiredCount: 0`

Use CDK context variable to deploy services with 0 tasks initially, push images, then deploy normally.

### Why This Solution
- Minimal code changes (3 lines in CDK)
- Works with existing CD workflow
- No manual steps after initial setup
- AWS-recommended pattern for ECS bootstrap

---

## Implementation Steps

### Step 1: Modify CDK Stack

**File:** `/Volumes/Code/doc-platform/infra/lib/doc-platform-stack.ts`

Add context check at top of constructor:
```typescript
const isBootstrap = this.node.tryGetContext('bootstrap') === 'true';
```

Modify all three ECS services to use conditional desiredCount:
- Line 272: `desiredCount: isBootstrap ? 0 : 1,` (ApiService)
- Line 310: `desiredCount: isBootstrap ? 0 : 1,` (FrontendService)
- Line 367: `desiredCount: isBootstrap ? 0 : 1,` (McpService)

### Step 2: Update CDK Deploy Workflow

**File:** `/Volumes/Code/doc-platform/.github/workflows/_deploy-cdk.yml`

Add `bootstrap` input parameter and pass to cdk deploy command when true.

### Step 3: Update CD Workflow

**File:** `/Volumes/Code/doc-platform/.github/workflows/cd.yml`

Add stack existence check to determine if this is first deploy:
```bash
if ! aws cloudformation describe-stacks --stack-name DocPlatformStack 2>/dev/null; then
  # First deploy - use bootstrap mode
fi
```

### Step 4: Delete Orphaned ECR Repos

The failed deployment left behind ECR repos with RETAIN policy:
```bash
aws ecr delete-repository --repository-name doc-platform/api --force
aws ecr delete-repository --repository-name doc-platform/frontend --force
aws ecr delete-repository --repository-name doc-platform/mcp --force
```

### Step 5: Deploy Fresh

1. `cd infra && npx cdk deploy --context bootstrap=true` - Creates everything with 0 tasks
2. Build and push images to ECR
3. `cd infra && npx cdk deploy` - Updates services to desiredCount: 1

---

## Files to Modify

1. `/Volumes/Code/doc-platform/infra/lib/doc-platform-stack.ts` - Add bootstrap context check
2. `/Volumes/Code/doc-platform/.github/workflows/_deploy-cdk.yml` - Add bootstrap input
3. `/Volumes/Code/doc-platform/.github/workflows/cd.yml` - Add first-deploy detection

## Execution Order

1. Delete orphaned ECR repos (cleanup from failed deploy)
2. Modify CDK stack code
3. Deploy with `--context bootstrap=true`
4. Build and push all Docker images
5. Deploy again without bootstrap flag
6. Update workflows for future automated deploys
