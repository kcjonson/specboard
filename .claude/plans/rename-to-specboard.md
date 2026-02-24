# Rename doc-platform → Specboard

## Context

The product is now called **Specboard** (specboard.io). All AWS resources, npm packages, code references, and documentation still use the old `doc-platform` naming. The staging environment also lacks a proper env prefix (e.g., resources are just `doc-platform` instead of `specboard-staging`), making it hard to distinguish from production in the AWS console. Since we may add environments in the future, we need a consistent `specboard-{env}` naming convention.

**Key simplification**: All resources (including prod DBs) can be torn down and recreated. No migration needed.

---

## New Naming Convention

Production is the implied default — no env suffix. Non-production environments are qualified.

| Dimension | Production | Staging | Pattern for future envs |
|---|---|---|---|
| Stack name | `Specboard` | `SpecboardStaging` | `Specboard{Env}` |
| Resource prefix | `specboard` | `specboard-staging` | `specboard-{env}` |
| Secrets path | `specboard/*` | `specboard/staging/*` | `specboard/{env}/*` |
| Log groups | `/specboard/*` | `/specboard/staging/*` | `/specboard/{env}/*` |
| ECS cluster | `specboard` | `specboard-staging` | `specboard-{env}` |
| ECR repos | `specboard/*` (shared) | ← same | ← same |
| DB name | `specboard` | `specboard` | `specboard` |
| npm packages | `@specboard/*` | — | — |

Note: "dev" means local development on developer machines (via docker-compose), not a cloud environment.

---

## PR 1: Code-Layer Rename

**Branch**: `rename/code-to-specboard`
**Risk**: Zero — npm package names and import paths are resolved at build time, never appear in AWS resource names.

### Changes

**Package names** (all `@doc-platform/*` → `@specboard/*`):
- Root `package.json`: name field
- All 22 workspace `package.json` files: name + dependency references
- `mcp/package.json`: bin name `doc-platform-mcp` → `specboard-mcp`

**TypeScript path aliases** (`@doc-platform/*` → `@specboard/*`):
- `tsconfig.json` (root — 13 aliases)
- `api/tsconfig.json`
- `frontend/tsconfig.json`
- `sync-lambda/tsconfig.json`
- `shared/ui/tsconfig.json`
- `shared/models/tsconfig.json`
- `shared/auth/tsconfig.json`

**Vite config**:
- `web/vite.config.ts` — all resolve aliases

**Source imports** (~220 occurrences across ~117 files):
- All `from '@doc-platform/*'` → `from '@specboard/*'`

**Docker**:
- `docker-compose.yml`: DB name `doc_platform` → `specboard`, S3 bucket `doc-platform-storage` → `specboard-storage`, mount path `/host/doc-platform` → `/host/specboard`
- `frontend/Dockerfile`: workspace refs

**Application code**:
- `storage/src/services/s3.ts`: default bucket name
- `shared/db/src/migrate.ts`: advisory lock hash string

**CI/CD workspace references** (must change with package names):
- `.github/workflows/_deploy-cdk.yml`: `@doc-platform/sync-lambda` → `@specboard/sync-lambda`, `@doc-platform/infra` → `@specboard/infra`

**Docs**:
- `README.md`, `CLAUDE.md`, `docs/setup.md`, `docs/tech-stack.md`, `infra/README.md`
- Spec files with `@doc-platform/*` references

**Generated**:
- `package-lock.json` — regenerated via `docker compose run --rm api npm install`

### After merge
Normal CD pipeline runs. Images build and deploy to the existing `doc-platform` infrastructure. Nothing breaks.

---

## PR 2: Infrastructure + CI/CD Rename

**Branch**: `rename/infra-to-specboard`
**Risk**: Requires full infrastructure teardown/rebuild (planned downtime).

### CDK Changes

**File rename**: `infra/lib/doc-platform-stack.ts` → `infra/lib/specboard-stack.ts`

**`infra/lib/specboard-stack.ts`**:
- Class `DocPlatformStack` → `SpecboardStack`
- Interface `DocPlatformStackProps` → `SpecboardStackProps`
- Route53 comment: `'Managed by CDK - specboard'`
- DB name: `doc_platform` → `specboard` (all env var occurrences)
- Deploy role: `doc-platform-github-actions-deploy` → `specboard-github-actions-deploy`
- OIDC sub claims: `repo:kcjonson/doc-platform:*` → keep as-is (repo not renamed yet)
- ECS ARN patterns: `doc-platform*` → `specboard*`
- PassRole: `DocPlatformProd-*` → `Specboard-*`
- **ECR repos**: Staging creates repos (CDK-managed with RETAIN), production imports via `fromRepositoryName()`
- **OIDC provider**: Import via `fromOpenIdConnectProviderArn()` (account-level prerequisite)

**`infra/lib/environment-config.ts`**:
- `ECR_REPO_NAMES`: `doc-platform/*` → `specboard/*`
- Production (implied default — no suffix): `stackName: 'Specboard'`, `resourcePrefix: 'specboard'`, `secretsPrefix: 'specboard'`, `logInfix: ''`
- Staging: `stackName: 'SpecboardStaging'`, `resourcePrefix: 'specboard-staging'`, `secretsPrefix: 'specboard/staging'`, `logInfix: 'staging/'`
- Remove backward-compatibility comments
- Enable `storageEncrypted: true` for staging (rebuilding removes the old unencrypted constraint)

**`infra/bin/app.ts`**:
- Import from `specboard-stack`, use `SpecboardStack`

### ECR repos: stay in CDK

ECR repos remain CDK-managed. Staging creates them (`new ecr.Repository` with `RETAIN` policy), production imports them (`fromRepositoryName`). This keeps CDK as the single source of truth — one command spins up a complete environment.

The `RETAIN` policy means ECR repos survive stack deletion (protecting production images). On teardown/rebuild, RETAIN resources must be cleaned up before re-deploying (see Phase 2 below). This is a known tradeoff, documented explicitly.

### OIDC provider: imported, not created

The GitHub OIDC provider is an account-level singleton (one per issuer URL). CDK imports it via `fromOpenIdConnectProviderArn()` rather than creating it. This avoids the RETAIN conflict on teardown/rebuild and matches its true lifecycle — it's an account prerequisite like `cdk bootstrap`, not a per-stack resource.

### CI/CD Changes

**`.github/workflows/_build-images.yml`**:
- ECR prefix: `doc-platform` → `specboard`

**`.github/workflows/_deploy-cdk.yml`**:
- Stack names: `DocPlatformStack` → `SpecboardStaging`, `DocPlatformProd` → `Specboard`

**`.github/workflows/cd.yml`**:
- `get-stack-outputs.sh DocPlatformStack` → `SpecboardStaging`

**`.github/workflows/prod-deploy.yml`**:
- ECR repo names: `doc-platform/*` → `specboard/*`
- Stack output refs: `DocPlatformProd` → `Specboard`

**`.github/workflows/prod-rollback.yml`**:
- ECR repo names and stack output refs (`DocPlatformProd` → `Specboard`)

**`.github/workflows/_run-ecs-task.yml`**:
- Stack name resolution: `DocPlatformProd` → `Specboard`, `DocPlatformStack` → `SpecboardStaging`

**`.github/scripts/get-stack-outputs.sh`**:
- Default stack name: `SpecboardStaging`

---

## Infrastructure Rebuild

Execute after merging PR 2. **Expected downtime: ~1-2 hours.**

### Account prerequisites (one-time, outside CDK)

These exist at the AWS account level, like `cdk bootstrap`. They are NOT per-stack resources.

1. **CDK bootstrap** — `cdk bootstrap aws://<ACCOUNT_ID>/us-west-2` (already done)
2. **GitHub OIDC provider** — one per account per issuer URL. CDK imports it, does not create it.

```bash
# Only needed if the OIDC provider doesn't already exist:
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --region us-west-2
```

### Phase 1: Tear down old stacks

```bash
# 1. Disable production RDS deletion protection
aws rds modify-db-instance --db-instance-identifier <prod-db-id> \
  --no-deletion-protection --region us-west-2
aws rds modify-db-instance --db-instance-identifier <prod-storage-db-id> \
  --no-deletion-protection --region us-west-2

# 2. Delete production first (depends on staging's shared resources)
aws cloudformation delete-stack --stack-name DocPlatformProd --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name DocPlatformProd --region us-west-2

# 3. Delete staging
aws cloudformation delete-stack --stack-name DocPlatformStack --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name DocPlatformStack --region us-west-2
```

### Phase 2: Clean up RETAIN resources

CDK uses `removalPolicy: RETAIN` on resources that must survive stack deletion (ECR repos
shared with production, S3 data buckets, secrets, log groups). After a full teardown these
orphaned resources block re-deploy because CloudFormation sees "already exists" errors.
Delete them all before Phase 3.

```bash
# ECR repos (old AND new names — covers both rename scenarios)
for repo in doc-platform/api doc-platform/frontend doc-platform/mcp doc-platform/storage \
            specboard/api specboard/frontend specboard/mcp specboard/storage; do
  aws ecr delete-repository --repository-name "$repo" --force --region us-west-2 2>/dev/null
done

# Log groups
for lg in /doc-platform/errors /doc-platform-prod/errors \
  /ecs/api /ecs/frontend /ecs/mcp /ecs/storage \
  /ecs/production/api /ecs/production/frontend /ecs/production/mcp /ecs/production/storage \
  /lambda/github-sync /lambda/production/github-sync \
  /specboard/staging/errors /specboard/errors \
  /ecs/staging/api /ecs/staging/frontend /ecs/staging/mcp /ecs/staging/storage; do
  aws logs delete-log-group --log-group-name "$lg" --region us-west-2 2>/dev/null
done

# Secrets
for prefix in doc-platform production/doc-platform specboard specboard/staging; do
  aws secretsmanager list-secrets --filter Key=name,Values="$prefix" --region us-west-2 \
    --query 'SecretList[].Name' --output text | tr '\t' '\n' | while read -r name; do
    [ -n "$name" ] && aws secretsmanager delete-secret --secret-id "$name" \
      --force-delete-without-recovery --region us-west-2
  done
done

# S3 buckets
for bucket in $(aws s3 ls | awk '{print $3}' | grep -E 'doc-platform|specboard'); do
  aws s3 rb "s3://$bucket" --force
done

# Old deploy role
ROLE=doc-platform-github-actions-deploy
aws iam list-attached-role-policies --role-name "$ROLE" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null | \
  tr '\t' '\n' | while read -r arn; do aws iam detach-role-policy --role-name "$ROLE" --policy-arn "$arn"; done
aws iam list-role-policies --role-name "$ROLE" --query 'PolicyNames[]' --output text 2>/dev/null | \
  tr '\t' '\n' | while read -r pol; do aws iam delete-role-policy --role-name "$ROLE" --policy-name "$pol"; done
aws iam delete-role --role-name "$ROLE" 2>/dev/null
```

### Phase 3: Bootstrap deploy (chicken-and-egg)

The CD pipeline authenticates via an OIDC deploy role (`specboard-github-actions-deploy`),
but that role is created by CDK inside the staging stack. CDK can't run without it.

Solution: create a temporary bootstrap role, run CDK in bootstrap mode, then swap to the
real role CDK created.

```bash
# 1. Create temporary bootstrap role with OIDC trust
cat > /tmp/trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": [
        "repo:kcjonson/doc-platform:ref:refs/heads/main",
        "repo:kcjonson/doc-platform:environment:staging",
        "repo:kcjonson/doc-platform:environment:production"
      ]}
    }
  }]
}
EOF

aws iam create-role --role-name specboard-bootstrap-deploy \
  --assume-role-policy-document file:///tmp/trust-policy.json \
  --max-session-duration 7200

# 2. Grant CDK bootstrap role assumption + CloudFormation read
cat > /tmp/bootstrap-perms.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/cdk-hnb659fds-*-<ACCOUNT_ID>-us-west-2" },
    { "Effect": "Allow", "Action": "cloudformation:DescribeStacks", "Resource": "*" }
  ]
}
EOF

aws iam put-role-policy --role-name specboard-bootstrap-deploy \
  --policy-name bootstrap-permissions \
  --policy-document file:///tmp/bootstrap-perms.json

# 3. Point GitHub Actions at the temp role
gh secret set AWS_DEPLOY_ROLE_ARN \
  --body "arn:aws:iam::<ACCOUNT_ID>:role/specboard-bootstrap-deploy"

# 4. Trigger bootstrap deploy (CDK only — no images, no ECS tasks)
gh workflow run cd.yml --field bootstrap=true
# Wait for it to complete (~10-15 min for full stack creation)

# 5. Swap to the real deploy role that CDK just created
REAL_ROLE=$(aws cloudformation describe-stacks --stack-name SpecboardStaging \
  --query "Stacks[0].Outputs[?OutputKey=='GitHubActionsRoleArn'].OutputValue" \
  --output text --region us-west-2)
gh secret set AWS_DEPLOY_ROLE_ARN --body "$REAL_ROLE"

# 6. Delete the temporary bootstrap role
aws iam delete-role-policy --role-name specboard-bootstrap-deploy \
  --policy-name bootstrap-permissions
aws iam delete-role --role-name specboard-bootstrap-deploy
```

### Phase 4: Full staging deploy

```bash
# Trigger normal CD (builds images, pushes to ECR, deploys ECS services)
gh workflow run cd.yml
# CD will: build images → push to specboard/* ECR → deploy services → migrate → seed
```

### Phase 5: Deploy production

```bash
gh workflow run prod-deploy.yml
# Or create a GitHub release to trigger it
```

### Phase 6: Verify

```bash
curl -sf https://staging.specboard.io/api/health
curl -sf https://specboard.io/api/health
```

---

## Note: GitHub Repo Rename Deferred

The GitHub repo stays as `kcjonson/doc-platform` for now. OIDC sub claims in CDK continue to reference `repo:kcjonson/doc-platform:*`. This can be revisited later.

---

## Verification

After each PR:
- **PR 1**: `docker compose build && docker compose up` — verify all services start, imports resolve
- **PR 2 + manual rebuild**:
  - `curl https://staging.specboard.io/api/health`
  - `curl https://specboard.io/api/health`
  - Verify AWS Console shows `specboard-staging-*` (staging) and `specboard-*` (production) resource names
  - Verify CloudWatch logs appear under `/specboard/staging/*` and `/specboard/*`
  - Trigger a test deployment to verify full CD pipeline works

## Key Files

- `infra/lib/environment-config.ts` — central source of truth for all resource naming
- `infra/lib/doc-platform-stack.ts` → `specboard-stack.ts` — CDK stack definition
- `infra/bin/app.ts` — CDK app entry point
- `tsconfig.json` — root TypeScript path aliases
- `.github/workflows/_build-images.yml` — ECR image path prefix
- `.github/workflows/cd.yml` — staging deploy orchestration
- `docker-compose.yml` — local dev DB names and mount paths
