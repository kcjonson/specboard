# Manual verification

How to verify a release that automated coverage can't vouch for. The process below
came out of the slug-migration release (v0.10.0, 2026-08), where a boot-crashing API
shipped through green typecheck, lint, and 560 passing tests — and the deploy
pipeline reported success while ECS silently rolled it back.

## When a manual pass is required

- **Schema migrations that touch existing data** — backfills, constraint additions,
  identifier changes.
- **Hard API cuts** — old argument names removed rather than aliased.
- **Code that has never executed in its production runtime.** This is the trap that
  motivated this document: `tsc` and vitest run TypeScript through transpilers that
  accept the full language, while production runs Node's strip-only loader, which
  accepts only the erasable subset. `erasableSyntaxOnly` in tsconfig now catches the
  syntax class, but only booting the server proves the wiring. If a branch merged
  without anyone loading the app in a browser, treat it as unverified regardless of
  test count.

The unit of verification is a **runbook**: a short doc listing test areas ordered by
risk, each test with concrete steps and an expected result specific enough to fail.
Write it before clicking; record pass/fail as you go.

## Pre-flight: prove the deploy landed

Do this before any UI testing. If the deploy didn't land, every UI result is noise.

**Don't trust `/api/health`** — it returns a static `{"status":"ok"}` without
touching the database, so it reports green even when every write fails.

**Check what ECS is actually running.** A deploy "succeeding" and the new code
serving are different claims; the circuit breaker can roll a service back to the
previous task definition (the deploy script fails loudly on this now, but verify
anyway):

```bash
aws ecs describe-services --cluster specboard-staging \
  --services api frontend mcp storage \
  --query 'services[].{name:serviceName,taskDef:taskDefinition,rollout:deployments[0].rolloutState}'
```

Every `rollout` must be `COMPLETED` and the task definitions must be the revisions
the deploy just registered — not older ones.

**Run integrity SQL with a one-off Fargate task.** The RDS instances are private;
the same pattern CI uses for migrations runs ad-hoc scripts against the live
database. The api task definition carries the DB environment, so a container
override with an inline script is all it takes:

```bash
export AWS_REGION=us-west-2
source .github/scripts/get-stack-outputs.sh SpecboardStaging   # or Specboard for prod
.github/scripts/run-ecs-task.sh preflight \
  '["node","--input-type=module","-e","<inline script using pg + process.env>"]'
```

The script builds its connection string the way `shared/db/src/migrate.ts` does
(DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD, `sslmode=no-verify`), runs its
queries, and prints tagged results. Read the output from CloudWatch: log group
`/ecs/staging/api` (prod: `/ecs/api`), stream `api/api/<taskId>`.

What to query depends on the migration, but the shape is constant: uniqueness
constraints hold, formats match what the app validates, backfilled columns have no
NULLs, allocators/sequences are not behind the data they allocate for. Every check
should expect **zero rows**.

## The UI pass

Principles that found real bugs, in descending order of yield:

- **Write, then reload.** The highest-risk flows are the ones that send a request
  and only look right because of local state. Type into a document, wait out the
  save debounce, hard-reload, confirm the content came back from the server.
- **Assert on the Network tab, not the pixels.** The worst slug-migration bug was a
  save that PUT to a UUID path and 404'd while the editor looked fine. The check is
  the request line: method, path shape, status.
- **Race async initialization deliberately.** Hard-reload and click as fast as
  possible; anything that reads an id fetched after mount is suspect.
- **Walk the error paths.** Nonexistent keys in URLs, taken names in forms, invalid
  parents in creates. The expected result is a specific error surface — not a
  crash, not a silently created stray, not a full-page takeover that eats the form.
- **Exercise browser history as a feature.** If selection or navigation writes
  URLs, then Back, Forward, deep links in a fresh tab, and query-param survival are
  all test cases.
- **Order areas by risk and start at the top.** Risk = (writes to the server) ×
  (how recently the code changed) × (whether it has ever run before).

Staging etiquette: test data is fine, but clean up after the pass — deleted items
leave numbering gaps by design, and the git-backed file store keeps pending changes
until they're committed or discarded, so restore files to their committed content
when done.

## Production release ritual

For any release containing a schema migration:

1. **Read-only pre-check** of the prod database (one-off task, prod stack): current
   migration level, row counts, and any data that stresses the migration's edge
   cases (duplicates the backfill must suffix, over-length values, orphans).
2. **Manual RDS snapshot, and wait for it.** There are no down-migrations;
   snapshot-restore is the rollback path. Publish the release only after the
   snapshot reports `available`:
   ```bash
   aws rds create-db-snapshot \
     --db-instance-identifier <prod-instance> \
     --db-snapshot-identifier pre-<migration>-<date>
   aws rds wait db-snapshot-available --db-snapshot-identifier pre-<migration>-<date>
   ```
3. **Publish the release** (see [deployment.md](deployment.md)). Caveat until the
   pipeline is fixed: the prod `migrate` job runs from the `:init` image tag, which
   every staging build repushes from `main` — so it runs `main` HEAD's migrations,
   not the tag's. Releasing `main`'s tip is safe; releasing an older tag is not.
4. **Verify by evidence, not by the green run:**
   - the migrate task's CloudWatch log says `Applied N migration(s)` with no errors;
   - all services' rollouts are `COMPLETED` on the new task definitions;
   - an error sweep of `/ecs/api` and `/ecs/mcp` since the deploy timestamp shows
     nothing new (compare against the hours before — pre-existing noise is not a
     regression);
   - a signed-in click-through of real data, or at minimum the unauthenticated
     smoke checks in [deployment.md](deployment.md#verifying-a-deploy).

## Rollback stance

Fix forward. For a bad release without schema damage, `prod-rollback.yml` redeploys
old images. For schema damage, restore the pre-release snapshot — never hand-revert
a migration: re-applying an identifier/numbering migration later renumbers rows, so
every recorded key (branch names, PR links, bookmarks, MCP transcripts) would point
at different items.
