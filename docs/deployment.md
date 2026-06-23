# Deployment

Specboard runs in three independent environments, each with its own database and its
own deployed code. Editing source affects an environment only when that environment's
running code is updated.

| Environment | URL | How it updates |
|-------------|-----|----------------|
| **Local** | `http://localhost` | Docker containers mount the source; edit + restart the container → live immediately |
| **Staging** | `https://staging.specboard.io` | **Automatic** — every merge to `main` |
| **Production** | `https://specboard.io` | **Manual** — publish a versioned GitHub release |

> Key consequence: a fix verified locally (or even merged to `main`) is **not** live on
> production until a release is published. Merging only reaches staging.

---

## Staging (automatic)

Merging a PR to `main` runs CI (`.github/workflows/ci.yml`: lint, test, typecheck, build
images). On CI success, CD (`.github/workflows/cd.yml`) deploys to staging:

```
check → build-push (ECR images) → setup-aws → migrate → seed → deploy-services
```

Nothing manual. The image is tagged with the merge commit SHA and pushed to ECR, so that
SHA becomes deployable to production later.

---

## Production (manual release)

Production deploys from a **release tag**, not from `main` directly. `prod-deploy.yml`
triggers on a published GitHub release (or a manual dispatch with a tag).

### Prerequisites
- The commit is merged to `main`.
- **Staging CD succeeded for that commit** — `prod-deploy.yml`'s `verify-images` job
  checks ECR for images built from the tag's SHA. No images → the deploy fails. (CD builds
  them on merge, so a green staging deploy satisfies this.)

### Steps
1. Pick the next version (see [Versioning](#versioning)).
2. **Publish a release** at the merged commit — this triggers the deploy automatically:
   ```bash
   gh release create vX.Y.Z --target main \
     --title "vX.Y.Z — <summary>" \
     --notes "<release notes>"
   ```
   (Or create the release in the GitHub UI.) `--target main` tags `main`'s current tip;
   pass a specific branch/commit only if releasing something other than the tip.
3. Alternatively, deploy an **existing** tag without a new release:
   ```bash
   gh workflow run prod-deploy.yml -f tag=vX.Y.Z
   ```
4. The deploy runs:
   ```
   resolve (tag → SHA) → verify-images → setup-aws → migrate → seed
     → deploy-services → health-check → annotate-release
   ```
5. [Verify](#verifying-a-deploy).

### Bootstrap mode
`prod-deploy.yml` accepts a `bootstrap: true` input that provisions infrastructure only
(skips migrate/seed/service deploy). Used for first-time environment setup, not routine
deploys.

---

## Versioning

Releases follow semver, currently in the `v0.x.y` range:
- **Patch** (`v0.5.0 → v0.5.1`) — bug fixes, security fixes.
- **Minor** (`v0.5.x → v0.6.0`) — new features (may include breaking changes while < 1.0).

Each release gets a short descriptive title and notes summarizing the included PRs.

---

## Migrations

SQL migrations live in `shared/db/migrations/` as `NNN_name.sql`, applied in filename
order and tracked in the `schema_migrations` table.

- They run **automatically** as the `migrate` job in both staging (`cd.yml`) and production
  (`prod-deploy.yml`) — `node shared/db/src/migrate.ts`.
- The runner skips already-applied files and wraps each in a transaction, so deploys with
  **no new migrations are a safe no-op**, and re-runs are idempotent.
- To add one: create the next-numbered file (`NNN_description.sql`). It deploys with the
  code — no separate migration step to remember.

> Run migrations locally with `docker compose exec api sh -c 'cd /app/shared/db && npm run migrate'`.

---

## Rollback

To roll production back to a previous release tag:

```bash
gh workflow run prod-rollback.yml -f tag=vX.Y.Z
```

Optional inputs:
- `run_migrations=true` — only if the rollback target needs a different schema (rare;
  migrations are usually forward-only).
- `run_cdk=true` — for infrastructure-level rollback.

Rollback redeploys the services from the target tag's already-built images.

---

## Verifying a deploy

Health and a quick authorization smoke test (no credentials needed):

```bash
# Health
curl -s -o /dev/null -w "%{http_code}\n" https://specboard.io/api/health        # 200
curl -s https://specboard.io/mcp/health                                          # {"status":"ok"}

# Authz smoke test — an unauthenticated planning read must be rejected (401), not 200.
# Use any valid-v4 UUID; the auth gate runs before the project lookup.
curl -s -o /dev/null -w "%{http_code}\n" \
  https://specboard.io/api/projects/3f8a1c2e-9b4d-4e6f-8a1b-2c3d4e5f6a7b/epics    # 401
```

Swap `specboard.io` for `staging.specboard.io` to verify staging.

---

## Quick reference

| Task | Command |
|------|---------|
| Deploy to staging | merge to `main` (automatic) |
| Deploy to production | `gh release create vX.Y.Z --target main --title … --notes …` |
| Deploy an existing tag to prod | `gh workflow run prod-deploy.yml -f tag=vX.Y.Z` |
| Roll back production | `gh workflow run prod-rollback.yml -f tag=vX.Y.Z` |
| Watch a deploy | `gh run watch` / `gh run list --workflow=prod-deploy.yml` |
