# Production Environment

**Status:** Phases 1-3 implemented. Phase 4 requires operational steps (manual).
**Branch:** `feature/production-environment` (PR #95)
**Commits:** Phase 1 (`2030b011`), Phase 2+3 (`b6031e76`)

## Context

Builds on the work from PR #63 (stale, will be closed) and the deployment spec defined in that PR (not merged into this repository). The spec's core architecture is sound — promotion model, release-triggered deploys, environment config — but the implementation needs to be rebuilt on top of the current main, which has diverged significantly (pipeline reordering, health check changes, auth middleware updates).

Also incorporates deployment reliability fixes discovered during the MCP health check deploy failure (2026-02-19), where a CDK-triggered ECS rolling update with stale images caused a 1+ hour stuck deployment.

**Reference:** PR #63 deployment spec for architecture decisions (image promotion, rollback, env config, WAF, etc.)

### Key Patterns from PR #63 to Reuse

1. **Stack naming backward compatibility**: Staging stack stays `DocPlatformStack` (current name) to avoid CloudFormation replacement. Only production gets new name `DocPlatform-production`.
2. **`getFullDomain()` helper** on environment config: computes `subdomain.domain` vs just `domain`.
3. **Image verification step** in prod deploy: check ECR for exact SHA tag before deploying, fail fast if missing.
4. **Conditional seeding**: Only seed on first release (`v1.0.0`), skip on subsequent deploys.
5. **Separate concurrency groups**: Rollback uses `production-rollback` (not `production-deploy`) so rollbacks aren't blocked by a stuck deploy.
6. **Release annotation**: Write deploy metadata (SHA, timestamp, deployer) back to GitHub release after successful deploy.
7. **Health check with retry**: curl loop against ALB with backoff after deploy.
8. **Zero-downtime migration rules** from deployment spec: add column → deploy → backfill → deploy → drop old column.
9. **`role-duration-seconds: 7200`** must be applied to all prod workflow AWS credential steps (learned from today's ExpiredToken failure).

## Phase 1: Deployment Reliability (prerequisite)

Fix deployment failure modes before adding a production environment.

### 1.1 Reduce ALB target group deregistration delay

**Files:** `infra/lib/doc-platform-stack.ts`

All target groups (API, Frontend, MCP) use the default 300s deregistration delay. For services with `desiredCount: 1`, this adds 5 minutes per failed task cycle during rollbacks.

- Set `deregistrationDelay: cdk.Duration.seconds(30)` on all target groups
- 30s is enough for in-flight requests to complete

### 1.2 Add ECS Deployment Alarms

**Files:** `infra/lib/doc-platform-stack.ts`

Wire existing CloudWatch alarms to ECS `deploymentAlarms` so failed deploys trigger automatic rollback based on application-level metrics (not just task crashes). This complements the circuit breaker:

- **Circuit breaker** catches: container crashes, image pull failures, health check failures (task-level)
- **Deployment alarms** catch: elevated 5xx rates, latency spikes, error surges (app-level)

We already have `Alb5xxAlarm` and `Target5xxAlarm`. Wire them to ECS services:

```typescript
const service = new ecs.FargateService(this, 'Service', {
  // ... existing config
  circuitBreaker: { rollback: true },
  deploymentAlarms: {
    alarmNames: [target5xxAlarm.alarmName],
    behavior: ecs.AlarmBehavior.ROLLBACK_ON_ALARM,
  },
});
```

ECS monitors alarms during deploy + a bake period after. If alarm fires → auto rollback.

**Note on circuit breaker threshold (Jan 2024 change):** AWS lowered the minimum failure count from 10 to **3**. For our `desiredCount: 1` services, the circuit breaker now triggers after just 3 failed task launches (was 10). This is already active — no code change needed.

### 1.3 Verify rollback timing (investigation, no code)

CloudFormation has **no per-resource timeout** for ECS service stabilization (`cfn_options.creation_policy` is EC2/ASG only, not ECS). The circuit breaker IS the mechanism for fast failure detection.

With deregistration delay reduced to 30s (1.1) and circuit breaker triggering after 3 failures (already active), expected rollback time should be:
- ~3 task failure cycles × (~30s health check failure + 30s deregistration) ≈ **3-5 minutes**
- If still slow after 1.1 + 1.2, investigate CloudFormation event timing as separate issue

### 1.4 Fix `:latest` tag race condition (CRITICAL — from architecture review)

**Files:** `infra/lib/doc-platform-stack.ts`

Current CDK uses `fromEcrRepository(repo, 'latest')` in all 4 task definitions (lines 500, 595, 651, 713). This causes CDK to trigger a rolling update on every deploy, racing with the subsequent `deploy-services.sh --force-new-deployment`. With `desiredCount: 1`, this can kill tasks prematurely.

- Change all 4 task definitions to use a fixed placeholder tag: `fromEcrRepository(repo, 'init')`
- Push a trivial `init`-tagged image once during bootstrap
- CDK will never trigger rolling updates; only `deploy-services.sh` handles image promotion
- **Do this in Phase 1** (not Phase 2) because the race condition exists today in staging

### 1.5 Fix `_run-ecs-task.yml` missing `role-duration-seconds` (from architecture review)

**Files:** `.github/workflows/_run-ecs-task.yml`

This workflow's `configure-aws-credentials` step (line 36-38) does NOT set `role-duration-seconds: 7200`, unlike `cd.yml` and `_deploy-cdk.yml`. The `aws ecs wait tasks-stopped` call polls using the deploy role session — if a migration takes >1 hour, it fails with `ExpiredToken`.

- Add `role-duration-seconds: 7200` to the `configure-aws-credentials` step
- Fix immediately, not deferred to production work

### 1.6 Add PostgreSQL advisory lock to migration runner (from architecture review)

**Files:** `shared/db/src/migrate.ts`

The migration runner has no protection against concurrent execution. With `cancel-in-progress: true` on staging CD, a cancelled workflow leaves the ECS migration task running while the next pipeline starts a new migration. Two migration tasks can run simultaneously against the same database.

- Add `SELECT pg_advisory_lock(hashtext('doc-platform-migrations'))` at the start of the migration runner
- Release on completion (or rely on session disconnect for automatic release)
- This is a safety net for the expand/contract discipline (which is the primary protection)

### 1.7 Tune 5xx alarm thresholds for deployment compatibility (from architecture review)

**Files:** `infra/lib/doc-platform-stack.ts`

Current thresholds (>10 5xx in 5 minutes) may false-positive during normal rolling updates. During deregistration with `desiredCount: 1`, ALB returns 502/503 briefly.

- Change to `evaluationPeriods: 2` (10 minutes sustained) for deployment alarms
- Or use percentage-based alarm (>5% 5xx rate) instead of absolute count
- This is important before wiring alarms to `deploymentAlarms` in 1.2

### 1.8 Upgrade `aws-actions/configure-aws-credentials` (low priority)

**Files:** `.github/workflows/*.yml`

We're currently on v4. Research found v5 and v6 exist. v5 cleaned up boolean input handling; v6 is latest. Evaluate upgrade path — may not be needed if v4 is working, but track for awareness. **Not blocking.**

## Phase 2: Multi-Environment CDK Support

Refactor the CDK stack to support staging and production from the same code.

### 2.1 Create environment config

**New file:** `infra/lib/environment-config.ts`

Define per-environment settings (reference PR #63's `environment-config.ts`):

```typescript
interface EnvironmentConfig {
  name: 'staging' | 'production';
  stackName: string;
  domain: string;
  subdomain?: string;
  database: { instanceSize, multiAz, backupRetention, deletionProtection };
  ecs: { desiredCount, cpu, memory };
  secretsPrefix: string;
  waf: boolean;
}
```

Key differences between environments:
| Resource | Staging | Production |
|----------|---------|------------|
| Domain | staging.specboard.io | specboard.io |
| DB | t4g.micro, single-AZ, 1-day backup | t4g.medium, multi-AZ, 14-day backup |
| ECS | 1 task per service | 2 tasks per service |
| WAF | Off | On (AWS managed rules) |
| Deletion protection | Off | On |

### 2.2 Extract shared resources into a separate stack

**New file:** `infra/lib/shared-stack.ts`

Some resources must be shared across environments (not duplicated). Extract into a `SharedStack` deployed once:

- **ECR repositories** — images promoted by SHA tag, not rebuilt per environment
- **Route53 Hosted Zone** — one zone for `specboard.io`, both `staging.specboard.io` and `specboard.io` use it
- **ACM Certificate** — wildcard cert covers `*.specboard.io`
- **GitHub OIDC Provider** — only one per account

**CRITICAL: Do NOT use CDK cross-stack references** (from architecture review). CDK cross-stack refs create CloudFormation Exports that lock stacks together — the shared stack cannot be updated/destroyed while env stacks hold export references. Instead, pass resource identifiers as config strings:
- ECR repos: `ecr.Repository.fromRepositoryName(this, 'ApiRepo', config.ecrRepoNames.api)`
- Route53 zone: `route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: config.hostedZoneId, zoneName: config.domain })`
- ACM cert: `acm.Certificate.fromCertificateArn(this, 'Cert', config.certificateArn)`
- Deploy role ARN: stored in config, referenced by workflow secrets

This keeps stacks independently deployable and avoids CloudFormation Export lock-in.

**Deploy ordering for shared stack extraction** (from architecture review):
1. Deploy shared stack with zone + cert + ECR repos + OIDC
2. Update environment stack to reference shared resources via config strings
3. Deploy environment stack
4. Only then safe to destroy old environment stack (Route53 zone deletion breaks DNS until registrar NS records updated)

**Migration path:** Use `ecr.Repository.fromRepositoryName()` to import existing repos into the shared stack, then remove them from the environment stack. `cdk refactor` (preview since Sept 2025, requires `--unstable=refactor`) could do this automatically but is not GA yet — use manual import/remove approach.

### 2.3 Parameterize CDK stack

**Files:** `infra/lib/doc-platform-stack.ts`, `infra/bin/app.ts`

- Pass `EnvironmentConfig` into the stack constructor
- Replace all hardcoded values with config references
- **Staging stack keeps construct ID `DocPlatformStack`** (avoids CloudFormation replacement of existing stack)
- Production stack uses construct ID `DocPlatformProd`
- Use `--context env=staging|production` to select environment
- Default to `staging` when no context provided (backward compatible)

**CRITICAL: Fix hardcoded resource names.** Architecture review identified **27+ resources** that will COLLIDE in the same account. Complete list:

**Infrastructure:**
- `doc-platform-alb` → `doc-platform-${env}-alb`
- `doc-platform` (cluster) → `doc-platform-${env}`
- `doc-platform-redis-subnet-group` → `doc-platform-${env}-redis-subnet-group`
- `doc-platform-storage-${account}` (S3 bucket) → `doc-platform-${env}-storage-${account}`

**Secrets (7 total):**
- `doc-platform/db-credentials` → `${env}/doc-platform/db-credentials`
- `doc-platform/invite-keys` → `${env}/doc-platform/invite-keys`
- `doc-platform/api-key-encryption` → `${env}/doc-platform/api-key-encryption`
- `doc-platform/github-client-id` → `${env}/doc-platform/github-client-id`
- `doc-platform/github-client-secret` → `${env}/doc-platform/github-client-secret`
- `doc-platform/storage-api-key` → `${env}/doc-platform/storage-api-key`
- `doc-platform/storage-db-credentials` → `${env}/doc-platform/storage-db-credentials`

**Log groups:**
- `/ecs/api`, `/ecs/mcp`, `/ecs/storage` → `/ecs/${env}/api`, etc.
- Note: `/ecs/frontend` does NOT exist — frontend uses CDK auto-generated log group (inconsistency to fix)
- `/doc-platform/errors` → `/doc-platform/${env}/errors`
- `/lambda/github-sync` → `/lambda/${env}/github-sync`

**Lambda + SQS + SNS:**
- `doc-platform-github-sync` (Lambda) → `doc-platform-${env}-github-sync`
- `doc-platform-github-sync-dlq` → `doc-platform-${env}-github-sync-dlq`
- `doc-platform-github-sync-alarms` (SNS) → `doc-platform-${env}-github-sync-alarms`

**CloudWatch alarms (6 total):** all need `${env}-` prefix

**IAM (moves to shared stack):**
- `doc-platform-github-actions-deploy` → shared stack (single role, or `doc-platform-${env}-deploy` if split later)

**Service names:** Keep bare names (`api`, `frontend`, `mcp`, `storage`) — they are scoped to the cluster, which is already env-prefixed. No collision.

Where possible, prefer letting CDK auto-generate names (omit `*Name` props). Only keep explicit names where external references need them (e.g., deploy scripts that lookup by name).

Additional image-related changes:
- **Enable ECR immutable tags** — prevents accidental overwrites, ensures SHA tag always points to the same image
- **Enable `imageScanOnPush: true`** on all ECR repos (from architecture review) — free basic scanning, catches critical CVEs before deployment
- **Increase ECR lifecycle `maxImageCount`** from 3 to 20 (from architecture review) — 3 is too aggressive for SHA-based promotion. A burst of staging deploys would GC images production needs to promote. Use tag-based lifecycle rules: protect SHA-tagged images for 30 days, aggressively prune untagged.
- `:latest` tag fix already done in Phase 1.4

### 2.4 Add WAF for production

**Files:** `infra/lib/doc-platform-stack.ts`

**Note:** WAFv2 still has NO L2 CDK constructs (as of CDK 2.238.0, Feb 2026). Must use L1 `CfnWebACL` + `CfnWebACLAssociation`.

Conditionally create WAF when `config.waf === true`:
- `AWSManagedRulesCommonRuleSet` (OWASP Top 10, exclude `SizeRestrictions_BODY` for API compatibility)
- `AWSManagedRulesKnownBadInputsRuleSet` (Log4j, known exploits)
- `AWSManagedRulesSQLiRuleSet` (SQL injection — we have PostgreSQL)
- `AWSManagedRulesAmazonIpReputationList` (malicious IP blocking — free, recommended)
- Rate limiting rule (2000 req/5min per IP)
- Associate with ALB via `CfnWebACLAssociation`

### 2.5 Add CDK Aspect for production safety

**New file or section in stack:** `ProductionSafetyAspect`

Use CDK Aspects (stable, recommended) to apply cross-cutting concerns per environment:
- Deletion protection on RDS instances (production only)
- `removalPolicy: SNAPSHOT` on RDS (production), `DESTROY` on staging
- **Secrets Manager: `RETAIN` for production, `DESTROY` for staging** (from architecture review — `forceDeleteWithoutRecovery` from DESTROY is dangerous for production; accidental `cdk destroy` would irrecoverably delete DB passwords, API keys, OAuth creds)
- Backup retention enforcement
- S3 bucket retention policy

```typescript
class ProductionSafetyAspect implements IAspect {
  constructor(private readonly isProduction: boolean) {}
  visit(node: IConstruct): void {
    if (node instanceof rds.DatabaseInstance && this.isProduction) {
      (node.node.defaultChild as rds.CfnDBInstance)
        .addPropertyOverride('DeletionProtection', true);
    }
  }
}
```

**Note:** CDK Mixins (announced re:Invent 2025) are in developer preview — not relevant yet. Aspects are the correct tool.

### 2.6 Production-specific security

- RDS storage encryption at rest — **enable for both environments** (no performance impact, negligible cost, can't be enabled later without recreating the instance)
  - Staging DB will be wiped and recreated as part of this work (user confirmed staging is temporary). No migration needed — just add `storageEncrypted: true` and redeploy.
  - **Cleanup is automatic:** Both RDS instances have `removalPolicy: DESTROY`, S3 bucket has `autoDeleteObjects: true`. A `cdk destroy` + redeploy of the new parameterized stack will recreate everything clean.
  - **Git checkouts in S3 are recoverable:** GitHub is the source of truth. When users recreate projects, initial sync auto-triggers and re-downloads all content from GitHub. Only loss is uncommitted pending edits (acceptable for staging).
  - **Rebuild sequence:** `cdk destroy` → deploy new parameterized stack → migrate → seed → users recreate projects (auto-syncs).
  - **GOTCHA: Secrets Manager recovery window.** Current secrets (7 total, e.g. `doc-platform/db-credentials`) have NO `removalPolicy: DESTROY`. On `cdk destroy`, AWS puts them in "pending deletion" for 7-30 days. Recreating with the same name will FAIL. Fix: add `removalPolicy: DESTROY` to all secrets before destroying (CDK uses `forceDeleteWithoutRecovery`), AND prefix names with environment (`staging/doc-platform/db-credentials`) for multi-environment support.
  - **Pre-destroy checklist:**
    1. Add `removalPolicy: DESTROY` to all 7 Secrets Manager secrets
    2. Deploy that change to current staging stack
    3. Then `cdk destroy` — secrets deleted immediately, no recovery window
    4. Deploy new parameterized stack with env-prefixed secret names
- **Redis encryption** (from architecture review) — current `CfnCacheCluster` has NO `transitEncryptionEnabled`, `atRestEncryptionEnabled`, or `authToken`. All data in plaintext. Add `atRestEncryptionEnabled: true` and `transitEncryptionEnabled: true` for both environments. Requires cluster recreation (done during staging rebuild). Consider adding auth token in Secrets Manager.
- Deletion protection on RDS and ECS services (production only; staging gets `removalPolicy: SNAPSHOT`)
- Separate secrets path (`production/doc-platform/*`)
- **OIDC trust policy fix** (CRITICAL, from architecture review) — change `StringEquals` to `StringLike` on the `sub` claim. Add both patterns: `repo:kcjonson/doc-platform:ref:refs/heads/main` (staging CD) and `repo:kcjonson/doc-platform:ref:refs/tags/v*` (production releases). Current policy will reject all release-triggered deploys. Also, `workflow_dispatch` may be rejected depending on ref context.
- **IAM PassRole fix** (from architecture review) — expand `iam:PassRole` to include task roles and execution roles for ALL 4 services (API, frontend, MCP, storage), not just API. Current setup works only because CDK shares execution roles, but will break if roles diverge.
- **IAM DescribeStacks fix** (from architecture review) — expand to cover shared stack + both environment stacks (or use `*` since it's read-only).
- **RDS Multi-AZ**: Classic Multi-AZ DB Instance (standby replica) for production. "Multi-AZ DB Cluster" (2 readable standbys, faster failover) exists but requires `CfnDBCluster` workaround in CDK (high-level `DatabaseCluster` is Aurora-only) — overkill for our scale.
- **RDS instance sizing**: `db.t4g.medium` (4 GB RAM) for production, not `t4g.small`. PostgreSQL benefits significantly from memory for shared_buffers. Note: t4g runs in Unlimited burst mode by default — monitor CPU credit balance. Graviton4 `db.m8g` family available if we outgrow burstable.
- **Database Insights**: AWS is deprecating Performance Insights by June 2026. CDK now has `databaseInsightsMode: DatabaseInsightsMode.STANDARD` (free tier, 7 days). Add to production config.

## Phase 3: Production Deploy Workflows

### 3.1 Update reusable workflows for environment support

**Files:** `_deploy-cdk.yml`, `_run-ecs-task.yml`, `_build-images.yml`, deploy scripts

Add `environment` input to reusable workflows:
- CDK deploy passes `--context env=$environment`
- ECS task runner uses the correct cluster name
- Deploy scripts resolve stack outputs for the target environment
- Build workflow remains environment-agnostic (images are shared)
- **Fix `deploy-services.sh` to pin image tags** (from architecture review) — register a new task definition with the exact SHA tag, then update the service to use that revision. Current approach (`--force-new-deployment` without `--task-definition`) pulls whatever `:latest` points to, which may be wrong for production if staging has deployed a newer build since.
- **Add post-deploy smoke test** (from architecture review) — curl ALB endpoint (`/api/health` and `/health`) after `ecs wait services-stable`. Services can be "stable" but have broken routes or missing env vars.
- **Parameterize `get-stack-outputs.sh`** — accept stack name as `$1` or `$STACK_NAME` env var (currently hardcodes `DocPlatformStack`)
- **Fix `_deploy-cdk.yml` hardcoded stack name** on line 81 (informational step, but will show wrong output for production)

**Note:** Reusable workflows (`workflow_call`) cannot inherit environment context from callers. The workaround is to pass environment name as an input and set `environment:` at the job level inside the reusable workflow:
```yaml
# Reusable workflow
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
jobs:
  deploy:
    environment: ${{ inputs.environment }}
    # Now has access to that environment's secrets
```

### 3.2 Update staging CD workflow

**Files:** `.github/workflows/cd.yml`

- Pass `environment: staging` to reusable workflows
- Keep existing pipeline ordering (build → CDK → migrate → seed → deploy)

### 3.3 Create production deploy workflow

**New file:** `.github/workflows/prod-deploy.yml`

Triggered by GitHub release publish:
1. Resolve the commit SHA that the release tag points to (via GitHub API)
2. **Verify images exist in ECR** for that SHA (fail fast if missing)
3. CDK deploy production stack (`--context env=production`)
4. Run migrations against production DB
5. Force ECS deployment with the release SHA's images
6. **Health check with retry** (curl loop with backoff against ALB)
7. **Annotate GitHub release** with deploy metadata (SHA, timestamp, deployer)

Pipeline: verify images → CDK → migrate → deploy → health check → annotate release

Key decisions from PR #63 spec:
- `cancel-in-progress: false` — never cancel production deploys
- `environment: production` — requires GitHub approval
- No seed step in production (staging only, and only on first release)
- `role-duration-seconds: 7200` on all AWS credential steps

### 3.4 Create rollback workflow

**New file:** `.github/workflows/prod-rollback.yml`

Manual trigger with release tag input:
1. Resolve SHA from release tag
2. Verify images exist
3. Force ECS deployment with that SHA's images (no CDK, no migrations by default)
4. Optional: run migrations (flag input, for cases where rollback needs a migration)
5. Wait for stable

Key details:
- **Separate concurrency group** (`production-rollback`) so rollbacks aren't blocked by a stuck deploy
- Checks out code at the rollback SHA (so deploy scripts match the target version)
- **Optional `run_cdk` input** (from architecture review) — when set, checks out the rollback tag's code and runs `cdk deploy`. Escape hatch for infrastructure-level issues (e.g., broken security group or removed env var that code-only rollback can't fix)

## Phase 4: First Production Deploy (Operational Steps)

### 4.0 Wire alarm notifications — DONE (folded into Phase 2)

Unified SNS alarm topic (`${resourcePrefix}-alarms`) created with all CloudWatch alarms wired. Set `alarmEmail` via `--context alarmEmail=you@example.com` when deploying.

### 4.1 Merge PR and deploy staging

1. Merge `feature/production-environment` PR to main
2. Wait for staging CD pipeline to succeed
3. Verify staging is healthy at https://staging.specboard.io

### 4.2 Set alarm email for staging (optional)

Re-deploy staging with alarm email:
```bash
# In GitHub Actions or locally
npx cdk deploy --context env=staging --context alarmEmail=ops@specboard.io
```

### 4.3 Bootstrap production

Pre-requisites:
- Staging stack deployed successfully (provides hosted zone ID and certificate ARN)
- Images exist in ECR from staging CD

Steps:
```bash
# 1. Bootstrap production (desiredCount=0, creates all resources)
cd infra
npx cdk deploy --context env=production --context bootstrap=true --require-approval never

# 2. Deploy production (normal desiredCount)
npx cdk deploy --context env=production --require-approval never

# Note: The CDK deploy workflow auto-resolves hostedZoneId and certificateArn
# from the staging stack outputs. For manual deploys, you can pass them:
# --context hostedZoneId=Z1234 --context certificateArn=arn:aws:acm:...
```

### 4.4 Create production secrets

After bootstrap creates the secrets with empty/random values, set real values:
```bash
# GitHub OAuth (create a separate OAuth app for specboard.io)
aws secretsmanager put-secret-value --secret-id production/doc-platform/github-client-id --secret-string "YOUR_PROD_CLIENT_ID"
aws secretsmanager put-secret-value --secret-id production/doc-platform/github-client-secret --secret-string "YOUR_PROD_CLIENT_SECRET"

# API key encryption key (generate fresh for production)
aws secretsmanager put-secret-value --secret-id production/doc-platform/api-key-encryption \
  --secret-string "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# Invite keys
aws secretsmanager put-secret-value --secret-id production/doc-platform/invite-keys --secret-string "key1,key2"

# DB credentials are auto-generated by CDK, no action needed
# Storage API key is auto-generated by CDK, no action needed
```

### 4.5 Run migrations and seed

```bash
# Via GitHub Actions (manually trigger prod-deploy.yml with a tag)
# Or via the _run-ecs-task.yml workflow with environment: production
```

### 4.6 Verify DNS and health

- Verify specboard.io resolves to the production ALB
- Check https://specboard.io/api/health
- Check https://specboard.io/health

### 4.7 Create first release

```bash
git tag v0.1.0
git push origin v0.1.0
gh release create v0.1.0 --title "v0.1.0 - First production release" --notes "Initial production deployment"
```

This triggers `prod-deploy.yml` which:
1. Verifies ECR images exist for the tag's SHA
2. Deploys CDK production stack
3. Runs migrations
4. Force-deploys ECS services
5. Health checks
6. Annotates the release with deploy metadata

---

## Files to Create/Modify

**New files:**
- `infra/lib/environment-config.ts`
- `infra/lib/shared-stack.ts` (ECR repos, Route53, ACM cert, OIDC provider)
- `.github/workflows/prod-deploy.yml`
- `.github/workflows/prod-rollback.yml`

**Modified files:**
- `infra/lib/doc-platform-stack.ts` (parameterize + reliability fixes + OIDC + PassRole + encryption + alarms)
- `infra/bin/app.ts` (environment selection)
- `.github/workflows/_deploy-cdk.yml` (environment input + stack name parameterization)
- `.github/workflows/_run-ecs-task.yml` (environment input + role-duration-seconds fix)
- `.github/scripts/get-stack-outputs.sh` (accept stack name parameter)
- `.github/scripts/deploy-services.sh` (image tag pinning + environment-aware)
- `.github/workflows/cd.yml` (pass environment: staging)
- `shared/db/src/migrate.ts` (advisory lock for concurrency protection)

## Architecture Review Findings (2026-02-19)

Three specialist agents (CDK Architecture, Security, Deployment Reliability) independently reviewed the plan and current CDK stack. **67 raw findings → 38 unique issues** after deduplication.

**Critical (8):** OIDC trust blocks tags, ECR lifecycle too aggressive, `:latest` race condition, cross-stack ref fragility, incomplete collision list (12 missed), no migration rollback, Redis no encryption, RDS no encryption.

**Warning (18):** PassRole scope, DescribeStacks scope, hardcoded stack/service names (x3), deploy script no image pinning, missing role-duration-seconds, single deploy role, no ECR scanning, unrestricted outbound SGs, no ALB logging, prod secrets DESTROY danger, Route53 destroy ordering, ACM migration, S3 bucket collision, alarm false positives, no smoke test, concurrent migration risk, partial deploy state.

**Suggestion (12):** WAF Linux rules, no alarm notifications, no S3 VPC endpoint, hardcoded env vars, TLS 1.3, VPC flow logs, no deploy metrics, sequential service deploy, migration timeout, CDK rollback option, monolithic stack, KMS encryption.

All critical and warning items have been incorporated into the plan phases above. Suggestions tracked in Out of Scope below.

## Out of Scope (with rationale from 2026-02-19 research)

- **ECS-native blue/green deployments** (launched July 2025) — no longer requires CodeDeploy, now built into ECS. Excellent feature but rolling updates + circuit breaker + deployment alarms is sufficient for our traffic. Consider for future if we need instant rollback.
- **ECS canary/linear deployments** (launched Oct 2025) — gradual traffic shifting built into ECS. Overkill for our scale.
- Blue-green databases (backward-compatible migrations are simpler)
- Multiple AWS accounts (single account with environment prefixes)
- Slack/Discord deploy notifications (future)
- **`configure-aws-credentials` v6 upgrade** — v4 works fine, v5/v6 are mostly cleanup. Low priority.
- **Separate deploy roles per environment** (W6) — single role + GitHub environment protection is sufficient for now. Can split later if needed.
- **ECS outbound security group restrictions** (W8) — `allowAllOutbound: true` is acceptable for now. Restrict when threat model requires it.
- **ALB access logging** (W9) — useful for production forensics but not blocking. Add post-launch.
- **VPC Flow Logs** (S6) — essential for incident response but adds cost. Add post-launch.
- **S3 KMS encryption** (S10) — SSE-S3 is sufficient. KMS adds fine-grained control but more complexity.
- **TLS 1.3** (S5) — TLS 1.2 is still acceptable. Upgrade to `SslPolicy.RECOMMENDED_TLS` post-launch after client compatibility testing.
- **Deploy metrics/observability** (S7) — CloudWatch deploy annotations. Nice-to-have for incident correlation.
- **Sequential service deployment** (W18) — deploy all 4 simultaneously for staging. Consider sequential for production post-launch.
- **Monolithic stack refactoring** (S9) — works fine at current scale. Break into constructs when it becomes painful.

**Note:** "Automated rollback on metrics" has been MOVED INTO SCOPE via deployment alarms (Phase 1.2). This is now a concrete implementation, not a future consideration.

## Resolved Questions (from PR #63 review)

1. **ECR repos: shared.** Images are promoted by SHA tag, not rebuilt. Both environments pull from the same repos.
2. **VPC: separate.** Production gets its own VPC for network isolation. Simpler than shared subnets with security group complexity.
3. **Deploy role: single role for now.** Same OIDC role deploys both environments. GitHub environment protection gates (`environment: production`) provides the approval barrier. Can split roles later if needed.

## Research Log (2026-02-19)

Key AWS changes since PR #63 (Oct 2025) that informed plan updates:

| Feature | Date | Impact |
|---------|------|--------|
| ECS circuit breaker min threshold → 3 | Jan 2024 | Already active. `desiredCount: 1` services fail fast after 3 task failures instead of 10. |
| ECS Deployment Alarms | Dec 2022 (mature) | Added to Phase 1.2. Wires CloudWatch alarms to auto-rollback on app-level issues. |
| ECS-native blue/green | Jul 2025 | Noted as future option. No CodeDeploy needed anymore. Rolling updates sufficient for now. |
| ECS canary/linear | Oct 2025 | Noted as future option. Gradual traffic shifting built into ECS. |
| No CF timeout for ECS | Confirmed Feb 2026 | Removed Phase 1.3 research items. Circuit breaker IS the mechanism. |
| `configure-aws-credentials` v6 | 2025 | v4 works. v5/v6 are incremental. Not blocking. |
| RDS encryption | No change | Enable for all environments. No perf impact, can't enable later without recreating. |
| RDS Multi-AZ DB Cluster | ~2023 | Exists but overkill. Classic Multi-AZ (standby) is right for our scale. |
| ALB deregistration delay | No change | Default still 300s. 30s confirmed reasonable by AWS docs. |
| GitHub env protection + tags | Available | Can restrict prod environment to tag patterns like `v*`. |
| Separate concurrency groups | Confirmed | Deploy and rollback should use different concurrency groups. |
| RDS encryption at rest | No change | Still can't enable on existing instances. Must snapshot → encrypted copy → restore. |
| RDS Multi-AZ DB Cluster | ~2023 | CDK `DatabaseCluster` still Aurora-only. Non-Aurora needs `CfnDBCluster`. Classic Multi-AZ sufficient. |
| RDS t4g.medium for prod | Confirmed | 4 GB RAM minimum for production PostgreSQL. Graviton4 `db.m8g` available for non-burstable. |
| Performance Insights → Database Insights | Deprecating Jun 2026 | Use `databaseInsightsMode: STANDARD` in CDK (free tier). |
| pgroll (expand/contract tool) | 2024+ | Open-source tool for zero-downtime PG migrations. Worth tracking, not needed yet. |
| ECR immutable tags | Available | Prevents accidental tag overwrites. Enable for SHA-based promotion safety. |
| ECR manifest re-tagging | Available | Can add tags without pulling/pushing layers via `put_image` API. Efficient promotion. |
| GitHub "secure by default" | Dec 2025 | Environment policy now evaluated against default branch, not PR branch. Closes security gap. |
| Reusable workflow env limitation | No change | `workflow_call` still can't inherit environment context. Pass env name as input workaround. |
| Concurrency pending limit | No change | Only 1 pending run per group (not a queue). A→B→C: B gets cancelled, C runs after A. |
| `:latest` tag anti-pattern | Confirmed | Task definitions should not use `:latest`. Causes CDK to trigger rolling updates with stale images. |
| CDK `cdk refactor` (preview) | Sept 2025 | Move resources between stacks without replacement. Preview only, needs `--unstable=refactor`. |
| CDK Mixins | Nov 2025 | Developer preview. Aspects remain the stable tool for cross-cutting concerns. |
| WAFv2 L2 constructs | Still none | RFC #394 and issue #17749 remain open. Must use L1 `CfnWebACL`. |
| `AWSManagedRulesAmazonIpReputationList` | Available (free) | Added to WAF plan — blocks known malicious IPs. |
| CDK Pipelines | Stable | Useful for multi-account. Overkill for single-account + GitHub Actions CI/CD. |
| Hardcoded resource names | Critical | Current stack has **27+** hardcoded physical names that will collide in same account. Must prefix with env. |
| Shared stack pattern | Best practice | ECR, Route53, ACM, OIDC should be in a separate stack shared across environments. |
| **Architecture Review** | **2026-02-19** | **3 specialist agents reviewed plan + CDK stack. 67 findings → 38 unique. All critical/warning incorporated into plan.** |
| OIDC trust blocks tag deploys | Critical (all 3 agents) | `StringEquals` on `refs/heads/main` rejects release-triggered deploys. Must use `StringLike` with tag pattern. |
| Cross-stack ref fragility | Critical (CDK agent) | Use `fromRepositoryName()` etc. instead of CDK exports. Avoids CloudFormation lock-in between stacks. |
| Redis no encryption | Critical (Security agent) | No `transitEncryptionEnabled` or `atRestEncryptionEnabled`. Add both + auth token. Requires cluster recreation. |
| ECR lifecycle too aggressive | Critical (all 3 agents) | `maxImageCount: 3` will GC production-needed images. Increase to 20. |
| Migration concurrency risk | Warning (Deploy agent) | No advisory lock. `cancel-in-progress` can leave orphaned migration task while new one starts. |
| PassRole only covers API | Warning (all 3 agents) | Will break if roles diverge after parameterization. Expand to all 4 services. |
| Deploy script no image pinning | Warning (Deploy agent) | `--force-new-deployment` pulls whatever `:latest` points to. Must register task def with SHA tag. |
| No ECR image scanning | Warning (Security agent) | `imageScanOnPush: true` is free. Catches CVEs before deployment. |
| Route53 destroy ordering | Warning (CDK agent) | Must extract to shared stack BEFORE `cdk destroy`. Otherwise DNS breaks. |
