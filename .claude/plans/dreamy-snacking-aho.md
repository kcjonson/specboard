# Fix CD Workflow for New Services

## Problem
The CD workflow runs `build-push` before `deploy-infra`. This fails for new services because:
- `build-push` tries to push images to ECR repos that don't exist yet
- `deploy-infra` (CDK) creates the ECR repos, but runs too late

Existing services (api, frontend, mcp) work because their repos were created in previous deployments.

## Solution
Reorder the CD workflow to run CDK first:

**Current order:**
1. check
2. build-push ← fails for new repos
3. migrate
4. seed
5. deploy-infra ← creates repos too late
6. deploy-services

**Fixed order:**
1. check
2. deploy-infra ← creates ECR repos, S3 bucket first
3. build-push ← repos now exist
4. migrate
5. seed
6. deploy-services

## File to Modify
`.github/workflows/cd.yml`

## Changes
1. Move `deploy-infra` job to run after `check`, before `build-push`
2. Update `needs` dependencies:
   - `deploy-infra`: needs `check`
   - `build-push`: needs `deploy-infra`
   - `migrate`: needs `build-push` (unchanged)
   - `seed`: needs `migrate` (unchanged)
   - `deploy-services`: needs `seed`

## One-time Cleanup
The storage ECR repo was manually created during debugging. Delete it so CDK can create it properly:
```bash
aws ecr delete-repository --repository-name doc-platform/storage --force
```

## Verification
1. Delete manually-created ECR repo (one-time cleanup above)
2. Commit and push the workflow change
3. Trigger CD workflow
4. Verify deploy-infra runs first and creates ECR repos
5. Verify build-push successfully pushes storage image
6. Verify full deployment completes
