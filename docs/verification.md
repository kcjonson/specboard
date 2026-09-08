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
- **Migrations whose backfill has never matched a row.** Same shape as the trap
  above, different subject. Staging is not a rehearsal for a data migration: it
  holds one project and a handful of fixture items, so when the item activity log
  migration ran there, no item had a notes value, the backup table captured
  nothing, and both backfill INSERTs matched zero rows. It reported success and
  verified nothing, and reading that green as clearance for production is reading
  an empty test suite as a passing one (SPE-184). The check that works: run the
  migration's **verbatim** backfill expression as a read-only SELECT against
  production before the release, and reconcile character counts. Characters
  dropped should equal the number of internal separators the parse consumes, and
  anything beyond that is data the migration is losing.

The unit of verification is a **runbook**: a short doc listing test areas ordered by
risk, each test with concrete steps and an expected result specific enough to fail.
Write it before clicking; record pass/fail as you go.

## Pre-flight: prove the deploy landed

Do this before any UI testing. If the deploy didn't land, every UI result is noise.

**Don't trust `/api/health`** — it returns a static `{"status":"ok"}` without
touching the database, so it reports green even when every write fails.

**Read `/version.txt` first.** It is the cheapest oracle available. The SHA is
baked into the frontend image at build time from the `GIT_SHA` build arg
(`frontend/Dockerfile`), so it attests the bytes the browser actually
downloaded, a stronger claim than a task-definition revision or a green
pipeline:

```bash
curl -s https://staging.specboard.io/version.txt   # must equal the SHA you shipped
```

Its limit is that it attests the **frontend** build only, and there is no
unauthenticated way to read the API task's SHA, so it narrows the question
rather than closing it. Follow it with the ECS check.

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

**Wait for the rollout to settle before clicking anything.** A deploy still
rolling is worse than one that failed outright, because it serves a mix of old
and new tasks and every result is unattributable. On the last pass staging did
not settle until roughly nineteen minutes after the run started, well after the
pipeline had gone green.

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

Two traps in that pattern, both of which have cost real time:

- **The container override is capped at 8 KiB.** Split the work across several
  plaintext runs when a script won't fit. Don't compress or base64 it down to
  size: a packed payload reads as obfuscated shell to a permission classifier and
  gets stopped, correctly.
- **The stack's `ApiTaskDefinitionArn` output can point at a revision whose image
  is gone.** It names revision 1, while the live api service runs a much later
  one, so a helper that resolves the task definition family without pinning a
  revision picks up that latest revision, whose ECR image the lifecycle policy has
  already pruned, and the run dies with `CannotPullContainerError` (SPE-175). Pin
  revision 1, which stays pullable because it uses the floating `:init` tag, or
  push a fresh tag first. Note that `:init` floating is the same thing that makes
  the prod migrate job run `main` HEAD's migrations (see the release ritual
  below), and it means revision 1's image content changes under you between
  deploys.

## The UI pass

Principles that found real bugs, in descending order of yield:

- **Write, then reload.** The highest-risk flows are the ones that send a request
  and only look right because of local state. Type into a document, wait out the
  save debounce, hard-reload, confirm the content came back from the server.
- **Assert on the Network tab, not the pixels.** The worst slug-migration bug was a
  save that PUT to a UUID path and 404'd while the editor looked fine. The check is
  the request line: method, path shape, status. Redirects need the same treatment,
  because a settled URL could equally be a client-side rewrite: `fetch(url,
  {redirect: 'manual'})` returning type `opaqueredirect` rather than `basic`,
  together with `performance.getEntriesByType('navigation')[0].redirectCount`,
  proves a real 302 crossed the wire.
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

### Probing routes without a session

`requireProjectAccess` validates the project slug before it checks the session,
so `GET /api/projects/Bad_Slug/<path>` answers `400 Invalid project slug format`
on a mounted route and `404 Not found` on an unmounted one. That distinguishes
"route removed" from "route gated" with no credentials at all, which is how you
prove a deleted endpoint is genuinely gone rather than merely unreachable. The
two 404 bodies are worth telling apart as well: `{"error":"Not found"}` comes
from `app.notFound` and means nothing matched, while `{"error":"Project not
found"}` means the route ran and the resource was missing.

Middleware ordering puts some checks out of reach unauthenticated, and knowing
which ones in advance keeps you from filing correct behavior as a failure. The
global `csrfMiddleware` 403s every unauthenticated POST, PUT and DELETE, so a
registered route and an unregistered one return identical `403 Forbidden` and
route registration simply cannot be probed for write methods. Likewise
`app.use('/mcp', mcpAuthMiddleware)` covers every method, so the auth gate always
precedes the 405 handler and `405 Allow: POST` is reachable only with a valid
token. Plan both for the authenticated pass.

### Driving the browser

Automation traps, roughly in the order they bite:

- **A native `confirm()` freezes all CDP automation on that tab.** Clicks,
  screenshots, and key presses all time out, and the only recovery is closing the
  tab. Plan delete flows, and anything else behind a native dialog, as manual
  steps.
- **`curl -I` sends HEAD.** Rate-limit rules string-compare the method, so a HEAD
  request falls through to the default bucket and a perfectly good rule looks
  broken. Use real GETs when reading `X-RateLimit-*`.
- **CDP `left_click_drag` does not initiate an HTML5 drag.** No `dragstart`, no
  PUT. Dispatch real `DragEvent`s carrying a live `DataTransfer` against the app's
  own handlers instead, which exercises the app's drag path but not Chrome's
  native drag machinery.
- **`resize_window` can report success while doing nothing**, when the browser
  window is fullscreen or shared with another session. Mounting the page in a
  same-origin iframe gives a genuine narrow viewport, since media queries resolve
  against the iframe's own box.
- **A background tab is timer-throttled**, which stretches debounces
  unpredictably; a 250ms debounce ran anywhere from 800ms to about a minute on the
  last pass. Structural assertions (which requests fired, with what params, and
  what rendered) survive that untouched. Absolute timings do not, so measure
  differentially or not at all.
- **Patching `window.fetch` from the extension's evaluation context does not
  intercept the app's traffic**, even though that context shares `window` with the
  page. Injecting a `<script>` element into the main world does work, and there is
  no CSP rule blocking it. Failure injection and request capture both depend on
  this, so reach for it before concluding a fault cannot be induced.

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

## Verifying a WAF change

Staging runs with `waf: false`, so a firewall change synths clean, diffs clean, and
proves nothing until it is in production. Budget for that: the first real test is prod.

1. **`cdk diff` against production before merging.** The resource list should be
   `AWS::WAFv2::WebACL` and nothing else. Anything extra means the branch is carrying
   drift, not a WAF fix.
2. **After deploy, trip a rule you expect to pass.** For a rule downgraded to count,
   send the request that used to fail (a `../` in an item description, say) and confirm
   it succeeds.
3. **Trip a rule you expect to block**, and read the response, not just the status: it
   should be the WAF's own JSON body, so a firewall rejection is never mistaken for an
   expired credential.
4. **Read `aws-waf-logs-specboard`.** `terminatingRule` names the rule that fired and
   `labels` names every rule that matched, including counted ones. This is the only
   place a false positive is legible; the sampled-requests console view is a three-hour
   window with no per-request detail:
   ```bash
   aws logs get-log-events --region us-west-2 \
     --log-group-name aws-waf-logs-specboard \
     --log-stream-name "$(aws logs describe-log-streams --region us-west-2 \
       --log-group-name aws-waf-logs-specboard --order-by LastEventTime --descending \
       --max-items 1 --query 'logStreams[0].logStreamName' --output text)"
   ```

A managed rule matching legitimate traffic is not a rare event, and it does not announce
itself as one. The signatures are written for URLs and form posts; on a JSON API whose
bodies are prose about software, `../`, SQL keywords, and angle brackets are content.

## Rollback stance

Fix forward. For a bad release without schema damage, `prod-rollback.yml` redeploys
old images. For schema damage, restore the pre-release snapshot — never hand-revert
a migration: re-applying an identifier/numbering migration later renumbers rows, so
every recorded key (branch names, PR links, bookmarks, MCP transcripts) would point
at different items.
