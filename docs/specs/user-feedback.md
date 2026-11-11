# User feedback

A project can collect feedback from the people using what it builds. The owner turns
it on in project settings and writes a prompt; that publishes a link to a small public
form, and the same link accepts submissions straight from software over HTTP. Feedback
lands in its own list in the project, opens in the right drawer like an item, and gets
triaged into real work by linking or converting it to items, from the UI or over MCP.

Feedback has no status of its own. What happened to it is whatever happened to the
items it's linked to.

## Scope

In:

- Per-project enable toggle, prompt, and a rotatable public submission link
- Public form at that link (logged out)
- Public JSON submission endpoint at the same token, for in-app feedback UIs and
  crash reporters
- Two types, `feedback` and `defect`, switchable during triage
- Feedback list view, its own nav tab, and a drawer for a single entry
- Linking feedback to existing items, converting feedback into a new item, and showing
  linked feedback on the item
- MCP tools for read, create, update, delete, link, and convert

Out, for now:

- Notifications (email on new feedback). The email package makes this easy later.
- Automatic crash capture (an SDK or beacon that posts crashes without a human). The
  endpoint takes `type: "defect"` so a reporter can be bolted on without changing it.
- Attachments and screenshots. `metadata` carries small text blobs (a stack trace, a
  log tail); files can come later through storage.
- Captcha. A honeypot plus rate limits first, captcha if spam shows up.
- Replying to the submitter.

This is a product feature for Specboard's users' projects. It is separate from
Specboard's own error pipe (`/api/metrics`, `logging-monitoring.md`), which stays an
internal, no-analytics channel. Specboard could dogfood its own feedback link later,
but nothing here depends on that.

## Data model

Migration `038_feedback.sql`.

### `projects` columns

| Column | Type | Notes |
|---|---|---|
| `feedback_enabled` | `BOOLEAN NOT NULL DEFAULT false` | Off means the form and endpoint 404 |
| `feedback_prompt` | `TEXT` | Shown at the top of the form. Same validation as `system_prompt` |
| `feedback_token` | `TEXT UNIQUE` | Random, URL-safe, 32 bytes. Generated on first enable, rotatable |
| `feedback_seq` | `INTEGER NOT NULL DEFAULT 0` | Per-project counter, same pattern as `item_seq` |

Separate columns, not a settings JSONB, matching how `system_prompt` was added.

The token is a capability to submit, nothing else. It is meant to be embedded in
shipped apps and public pages, so treat it as public: it can't read anything, and
rotating it is how an owner shuts off a leaked or abused link without turning feedback
off.

### `feedback`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID PK` | |
| `project_id` | `UUID NOT NULL` FK, cascade | |
| `number` | `INTEGER NOT NULL` | Per project, unique with `project_id`. UI shows `#12`, MCP takes `feedback_number` |
| `type` | `TEXT NOT NULL` | `feedback` or `defect`, CHECK constrained |
| `name` | `TEXT` | Optional, max 200 |
| `email` | `TEXT` | Optional, validated with `isValidEmail` when present, max 320 |
| `body` | `TEXT NOT NULL` | Required, max 20,000 chars, control characters stripped (newlines kept) |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'` | A JSON object. Caller-supplied keys plus the server's `request` key (below). Caller payload capped at 64 KB serialized |
| `source` | `TEXT NOT NULL` | `form`, `api`, or `manual` (created by a member or agent) |
| `created_by` | `JSONB` | Actor, only for `manual`. Public submissions have none |
| `submitted_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | Server time. Client clocks aren't trusted; a client timestamp can ride in `metadata` |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | |

Request context goes in `metadata`, not columns; nothing filters or sorts on it. On a
public submission the server writes `metadata.request`:

```json
{ "ip": "203.0.113.7", "userAgent": "...", "referrer": "https://app.example.com/map" }
```

`ip` is the client address from `X-Forwarded-For` as the load balancer sets it,
`referrer` is the request's `Referer`, else `Origin`, else absent. The server always
overwrites a caller-supplied `request` key, so it can't be spoofed into looking
server-captured. Everything else in `metadata` is the caller's. Manual entries get no
`request` key.

Feedback is the project's data, not Specboard's. The project owner is collecting it from
their own users the way they would with any form tool, so we capture the request
context a form tool would and leave it to them. Specboard doesn't use it beyond showing
it to the project; rate limiting reads the IP from the request, not the table.

Deletes are hard deletes, and deleting the project deletes its feedback.

### `feedback_items`

The join from feedback to items, following `item-relationships.md`: a dedicated table
per relation kind, no generic links table.

| Column | Type | Notes |
|---|---|---|
| `feedback_id` | `UUID NOT NULL` FK, cascade | |
| `item_id` | `UUID NOT NULL` FK, cascade | |
| `project_id` | `UUID NOT NULL` | Denormalized, both sides must match (enforced in the service) |
| `created_by` | `JSONB NOT NULL` | Actor |
| `created_at` | `TIMESTAMPTZ NOT NULL` | |

Primary key `(feedback_id, item_id)`. Many to many: one bug can absorb twenty reports
of the same crash, and one long piece of feedback can split into several items. Unlink
deletes the row; no tombstones, because a link carries no lifecycle worth keeping.
The link and unlink themselves are written to the linked item's activity log so the
history survives.

An item created by converting feedback also records it in `items.origin` as
`fromFeedback: { feedbackId, number }`, the same immutable-provenance shape as
`discoveredFrom`.

### Derived status

Computed in the service from linked items, never stored:

| Derived | When |
|---|---|
| `new` | No linked items |
| `open` | At least one linked item, and any linked item is not `done` |
| `resolved` | Every linked item is `done` |

The response also carries the linked items themselves (key, title, status), so the UI
can show the real item status next to the derived one. List filtering by derived
status is a SQL `EXISTS`/`NOT EXISTS` over `feedback_items` joined to `items`, not a
filter in application code, so pagination stays correct.

Noise (spam, duplicates nobody wants tracked) gets deleted. There's no "dismissed"
state, since that would be a status.

## Public submission

### Form

`GET /feedback/<token>`, a static SSG page like `invite` and `login`:

- Prompt from project settings, project name, and fields: name, email, feedback body.
  Body required, the rest optional. Type is always `feedback` from the form.
- A hidden honeypot field; a filled honeypot gets a normal-looking success response
  and is dropped.
- Posts to the JSON endpoint below; shows a thank-you state on success.
- Unknown token or feedback disabled: the standard hidden-route 404, so a disabled
  project is indistinguishable from a bad token.
- Frontend server: explicit route, prefix entry in the auth `excludePaths`, and the
  `noReferrerOnTokenPages` policy since the path carries a token.

The form needs the prompt and project name before it renders, so there is a small
public read: `GET /api/feedback/<token>` returns `{ projectName, prompt }` and nothing
else.

### Endpoint

`POST /api/feedback/<token>`, JSON body:

```json
{
	"type": "defect",
	"name": "Ada",
	"email": "ada@example.com",
	"body": "Crashed when I opened the map",
	"metadata": { "version": "1.4.2", "stack": "..." }
}
```

- `type` defaults to `feedback`. `body` required.
- `metadata`, when present, must be a JSON object (`400` otherwise). A crash log goes
  in as a string value, e.g. `{ "log": "..." }`. The server adds `metadata.request`.
- The form page is served with no-referrer, so its post carries no useful `Referer`.
  The form puts its own `document.referrer` in `metadata.pageReferrer` instead.
- `201` with `{ number }` on success. `400` with field errors on validation failure.
  `404` for unknown token or disabled. `413` over the body cap. `429` when rate
  limited.
- Lives under `/api/feedback/`, not `/api/projects/`, because it is ungated and
  `role-matrix.test.ts` forbids ungated routes under the project prefix.
- CSRF-excluded, like `/api/waitlist`. No cookies are read.
- CORS: `Access-Control-Allow-Origin: *`, no credentials, `POST` and `GET` with
  `Content-Type`, so a web app on any origin can post from the browser. Desktop and
  server clients don't care.
- Request size cap of 128 KB on this route before parsing.
- Rate limits through `rateLimitMiddleware`: a `feedbackSubmit` config per IP (start at
  20/hour), plus a per-token ceiling (start at 500/hour) so one leaked token can't fill
  a project. Check that the WAF body rules don't eat stack traces in prod, the same
  concern noted on the client error epic.

## Authenticated API

Under `/api/projects/:owner/:project/feedback`, gated like planning routes: reads are
`viewer`, writes are `editor`, settings are `owner`.

| Method | Path | Role | |
|---|---|---|---|
| `GET` | `/feedback` | viewer | List. Filters: `type`, `status` (derived), `search` (body, name, email). Newest first, paginated like items |
| `POST` | `/feedback` | editor | Manual create (`source: manual`) |
| `GET` | `/feedback/:number` | viewer | One entry with linked items and derived status |
| `PATCH` | `/feedback/:number` | editor | `type`, `name`, `email`, `body`, `metadata` |
| `DELETE` | `/feedback/:number` | editor | Hard delete |
| `POST` | `/feedback/:number/items` | editor | Link `{ itemKey }` |
| `DELETE` | `/feedback/:number/items/:itemKey` | editor | Unlink |
| `POST` | `/feedback/:number/convert` | editor | Create an item and link it. Body: `type` (default `bug` for defect, `task` for feedback), optional `title`, `parentKey` |
| `GET` | `/items/:itemKey/feedback` | viewer | Feedback linked to an item |

Settings go through the existing `PUT /api/projects/:owner/:project` as
`feedback_enabled` and `feedback_prompt`. Token rotation is its own
`POST /api/projects/:owner/:project/feedback-token` (owner), since a rotation is an
action, not a field.

Convert builds the item from the feedback: title from the first line of the body
(trimmed to the title limit) unless given, description is the body followed by a short
"From feedback #12, submitted by Ada on 2026-11-10" footer. Email and
metadata aren't copied; the link gets you there, and the item stays about
the work rather than the submitter.

## UI

- **Nav**: a `Feedback` tab in `WebHeader`, shown only when feedback is enabled, with a
  count of `new` entries.
- **Routes**: `/projects/:owner/:project/feedback` and
  `/projects/:owner/:project/feedback/:number` (drawer open), mirroring
  planning's board and board-with-drawer routes.
- **List**: a table in the style of the planning table. Columns: number, type, excerpt
  of the body, submitter (name, else email, else "Anonymous"), submitted date, derived
  status, linked item keys. Filters for type and derived status, `new` selected by
  default. Search box.
- **Drawer**: reuses `Workspace` and the resizable drawer. Shows the full body,
  submitter name and email (mailto), submitted date, source, a type toggle, metadata
  pretty-printed in a collapsed monospace block (multi-line string values render as
  preformatted text, which is how a crash log reads best), the linked items with their statuses, a
  link control built on `ItemPicker`, a "Create item" action that runs convert, and
  delete with a confirm.
- **Item view**: a "Feedback" section in `ItemView` listing linked feedback (number,
  excerpt) that opens the feedback drawer.
- **Settings**: a `Feedback` section in `ProjectSettings`, owner-editable: enable
  toggle, prompt textarea, the public link with copy, a rotate-link action with a
  confirm (it breaks every embedded copy), and a short curl example of the endpoint.

## MCP

A `feedback` tool module beside `items`, wired into `mcp/src/tools/index.ts`, same
project binding and `resolveToolProject` resolution, same role split:

| Tool | Role | |
|---|---|---|
| `get_feedback` | viewer | List with `type`, `status`, `search`, `limit`, or one by `feedback_number`; includes linked items and derived status. `metadata` is returned in full only on a single read |
| `create_feedback` | editor | Manual entry |
| `update_feedback` | editor | `type`, `name`, `email`, `body`, `metadata`, plus `link_item_keys` / `unlink_item_keys` |
| `delete_feedback` | editor | Destructive, idempotent |
| `convert_feedback` | editor | Same as the REST convert; returns the new item key |

Annotations follow the existing pattern, with entries added to `annotations.test.ts`
and the role matrix test. The server instructions string gets a sentence on feedback:
it has no status, triage means linking or converting.

Feedback body, name, and metadata are untrusted text from the public. MCP responses
return them as data fields, never interpolated into instructions, and the instructions
string says so, since an agent triaging feedback is reading text a stranger wrote.

## Open questions

- Whether the form should require email. Current default is optional everywhere,
  because crash reports and anonymous feedback are both legitimate.
- Whether the owner wants a per-project allowlist of origins for the CORS header
  instead of `*`. `*` is fine as long as the endpoint stays submit-only.
