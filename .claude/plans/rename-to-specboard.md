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
- **ECR repos**: Change staging to also use `fromRepositoryName()` (see architectural change below)
- Remove `createRepo` helper entirely

**`infra/lib/environment-config.ts`**:
- `ECR_REPO_NAMES`: `doc-platform/*` → `specboard/*`
- Production (implied default — no suffix): `stackName: 'Specboard'`, `resourcePrefix: 'specboard'`, `secretsPrefix: 'specboard'`, `logInfix: ''`
- Staging: `stackName: 'SpecboardStaging'`, `resourcePrefix: 'specboard-staging'`, `secretsPrefix: 'specboard/staging'`, `logInfix: 'staging/'`
- Remove backward-compatibility comments
- Enable `storageEncrypted: true` for staging (rebuilding removes the old unencrypted constraint)

**`infra/bin/app.ts`**:
- Import from `specboard-stack`, use `SpecboardStack`

### Architectural change: ECR repos out of CDK

Move ECR repo lifecycle management out of CDK. Both staging and production use `fromRepositoryName()`. ECR repos are created manually once as shared infrastructure (they already had `RETAIN` policy, proving they're meant to outlive stacks).

This solves the chicken-and-egg problem: CD pushes images BEFORE CDK deploy, so ECR repos must exist before any stack is deployed.

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

## Manual Steps: Infrastructure Rebuild

Execute after merging PR 2. **Expected downtime: ~1-2 hours.**

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

```bash
# Old ECR repos
for repo in doc-platform/api doc-platform/frontend doc-platform/mcp doc-platform/storage; do
  aws ecr delete-repository --repository-name "$repo" --force --region us-west-2
done

# Old log groups
for lg in /doc-platform/errors /doc-platform-prod/errors \
  /ecs/api /ecs/frontend /ecs/mcp /ecs/storage \
  /ecs/production/api /ecs/production/frontend /ecs/production/mcp /ecs/production/storage \
  /lambda/github-sync /lambda/production/github-sync; do
  aws logs delete-log-group --log-group-name "$lg" --region us-west-2 2>/dev/null
done

# Old secrets (list first, then delete)
aws secretsmanager list-secrets --filter Key=name,Values=doc-platform --region us-west-2
aws secretsmanager list-secrets --filter Key=name,Values=production/doc-platform --region us-west-2
# For each: aws secretsmanager delete-secret --secret-id <name> --force-delete-without-recovery

# Old S3 buckets
aws s3 rb s3://doc-platform-prod-storage-<ACCOUNT_ID> --force
aws s3 rb s3://doc-platform-storage-<ACCOUNT_ID> --force

# Old deploy role (policies first, then role)
aws iam list-attached-role-policies --role-name doc-platform-github-actions-deploy
# Detach each, then:
aws iam delete-role --role-name doc-platform-github-actions-deploy
```

### Phase 3: Create shared ECR repos (before any deploy)

```bash
for repo in specboard/api specboard/frontend specboard/mcp specboard/storage; do
  aws ecr create-repository --repository-name "$repo" \
    --image-scanning-configuration scanOnPush=true \
    --region us-west-2
done
```

### Phase 4: Deploy staging

```bash
# Trigger CD (after PR 2 is merged)
gh workflow run cd.yml

# CD will: build images → push to specboard/* ECR → CDK deploy SpecboardStaging → migrate → seed → deploy services

# After deploy, update GitHub Actions secret with new deploy role ARN:
aws cloudformation describe-stacks --stack-name SpecboardStaging \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'].OutputValue" --output text --region us-west-2
# Update AWS_DEPLOY_ROLE_ARN secret in GitHub repo settings
```

### Phase 5: Deploy production

```bash
# Get shared resource outputs from staging
aws cloudformation describe-stacks --stack-name SpecboardStaging \
  --query "Stacks[0].Outputs" --output table --region us-west-2

# Create a release to trigger production deploy, or:
gh workflow run prod-deploy.yml
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
