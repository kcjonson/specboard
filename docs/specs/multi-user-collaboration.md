# Multi-User Collaboration Specification

A project owner invites other people into a project with a role. Members see the
project's board and documents, editors change them, and every change stays
attributed to the person who made it. Tracked as SPE-10.

---

## Decisions

Settled before design, recorded here so they don't get re-litigated:

1. **Three roles: owner, editor, viewer.** Viewer exists in v1 chiefly as the state
   of an invitee who has not connected GitHub yet (see 3), and doubles as a
   genuine read-only role.
2. **URLs are namespaced by owner.** Every user has a **user slug** they choose,
   defaulting to their username. A project is addressed as `owner/project` in
   web routes, the REST API and MCP, under a `/projects/` prefix. In MCP only, a
   bare `project` means the caller's own project of that slug.
3. **Editors need their own GitHub connection.** Commits already run on the acting
   user's own token (`getEncryptedGitHubToken(session.userId)` in
   `api/src/handlers/github-sync.ts`), which is what makes git attribution
   honest. We keep that and never commit on someone else's behalf. The rule is
   flat: it applies to planning-only projects too, even though they have nothing
   to attribute, so there is one rule to explain.
4. **No real-time layer.** Boards keep polling, drafts stay private until commit,
   no presence. Filed as SPE-203.
5. **Deleting an owner's account deletes their projects**, including shared ones.
   Ownership transfer, manual or as a handoff on deletion, is SPE-204.

---

## Roles and Permissions

| Capability | Owner | Editor | Viewer |
|---|:-:|:-:|:-:|
| See the project, board, items, documents, activity | ✓ | ✓ | ✓ |
| See the member list | ✓ | ✓ | ✓ |
| Create / edit / move / delete items, notes, blockers, checklist | ✓ | ✓ | |
| Edit documents, commit, pull | ✓ | ✓ | |
| Add document comments (stored in the file, so it is a commit) | ✓ | ✓ | |
| AI chat over project documents | ✓ | ✓ | ✓ |
| Project settings: name, slug, key, AI instructions, repository | ✓ | | |
| Invite, change roles, remove members | ✓ | | |
| Delete the project | ✓ | | |
| Leave the project | | ✓ | ✓ |

The same matrix applies to MCP. A viewer's agent can read the board and can't write
to it.

### Granted role vs effective role

A membership stores the **granted** role. Access checks use the **effective**
role:

- `editor` with a GitHub connection → **editor**
- `editor` without one → **viewer**
- `viewer` → **viewer**

This means an owner invites someone as an editor once and never has to come back
to promote them. The invitee sees the project read-only until they connect
GitHub, then edits. Disconnecting GitHub drops the effective role back to viewer.
Drafts they already made are kept (pending changes are stored per user in the
storage service) and become committable again on reconnect.

The UI always says *why* someone is read-only, since "viewer by choice" and
"editor waiting on GitHub" need different next steps.

### Push access

A GitHub connection proves who you are, not that you can push to this repo.
Specboard doesn't enforce push access; GitHub does at commit time. But we surface
it early. On GitHub connect and when the member list loads (cached briefly), the
API checks `GET /repos/{owner}/{repo}` with the member's token and reads
`permissions.push`. No push access shows as a warning on the member's row (owner
view) and in the member's own banner. The member can still draft, and nothing is
lost if a commit is refused.

### What storage mode shares

- **Cloud** projects: board and documents.
- **None** (planning-only) projects: board only.
- **Local** projects (Electron, files on the owner's disk): board only. Members
  see a note in the document area explaining that the documents live on the
  owner's machine.

Viewers of a cloud project can read the repository's content through Specboard
even when the repo is private and they have no GitHub access to it. Inviting
someone is the owner sharing that content. The invite dialog says so when the
connected repo is private.

---

## User Slugs and URLs

### The user slug

- New column `users.slug`. It uses the project-slug alphabet
  (`shared/core/src/identifiers.ts`, `^[a-z0-9]+(-[a-z0-9]+)*$`) and is unique.
- The default is the username, lowercased, with `_` mapped to `-` (usernames allow
  `[A-Za-z0-9_]`); runs collapse and the ends trim, so `__jane_doe_` is `jane-doe`, and
  a username with nothing else left falls back to `user`.
- Claimed at onboarding next to the username, pre-filled from it and editable.
- Editable later in Settings → Personal Info, with a preview of the resulting URL.
  `PUT /api/users/:id` is the one way to change it; `PUT /api/auth/me` only takes a
  slug as part of the one-time onboarding claim.
- The migration backfills existing users. Collisions get a numeric suffix; the oldest
  account keeps the bare slug, and a suffix that is already someone's natural slug is
  skipped. Admin user create derives the same default and suffixes past collisions.
- Users who haven't onboarded yet have a `NULL` slug, and the
  `users_slug_matches_username` CHECK keeps slug `NULL` exactly when username is.
  Project create refuses a user without a slug, so every project has an address.
- Changing a slug moves every project URL the user owns and breaks
  `.mcp.json` bindings that name it. The settings field warns before saving. In v1
  the old URLs 404. Redirects for slug changes and for ownership transfers need
  the same mechanism, so both are built once, in SPE-204.

### Routes

| Surface | Before | After |
|---|---|---|
| Web | `/projects/:projectSlug/planning` | `/projects/:owner/:project/planning` |
| Web | `/projects/:projectSlug/items/:itemKey` | `/projects/:owner/:project/items/:itemKey` |
| Web | `/projects/:projectSlug/pages` | `/projects/:owner/:project/pages` |
| Web (new) | | `/projects/:owner/:project/settings` |
| REST | `/api/projects/:projectSlug/...` | `/api/projects/:owner/:project/...` |
| MCP header | `X-Specboard-Project: roadmap` | `X-Specboard-Project: acme/roadmap`, or `roadmap` for your own |
| MCP args | `project_slug: "roadmap"` | `project: "acme/roadmap"`, or `"roadmap"` for your own |

- The web app threads one `projectRef` string (`acme/roadmap`) through components and
  models in place of the old `projectSlug`, and interpolates it straight into
  `/projects/${projectRef}/...` and `/api/projects/${projectRef}/...`. The
  `projectUrlBoundary` test fails any `/api/projects/${...}` interpolation not named as
  a ref, which catches both a leftover bare slug and a UUID.

Keeping the `/projects/` prefix means user slugs never compete with top-level
routes (`/settings`, `/admin`, `/login`, `/invite`, ...). That avoids a reserved-word
list, which would otherwise have to grow with every new route.

- Item keys (`SPE-10`) stay unique per project and unchanged.
- The cookie `RootRedirect` reads is renamed `lastProjectRef` and stores
  `owner/project`. An old `lastProjectSlug` cookie is simply ignored.
- `list_projects` returns `owner`, `slug`, and the combined `ref`
  (`acme/roadmap`) that every other tool takes.
- **Bare slugs in MCP mean "my own project".** The MCP server expands a
  project reference with no `/` to the caller's slug before resolving, so
  there is still one resolver and one access check. Existing `.mcp.json`
  bindings keep working for their owners unchanged.
- The catch: a committed `.mcp.json` is shared by everyone who clones the repo,
  and a bare slug resolves against each caller's own projects. A collaborator
  on a repo bound with a bare slug gets "project not found". Repos with
  collaborators should bind the full `owner/project`, and the not-found error
  for a bare slug says so. This repo's own `.mcp.json` moves to
  the full `owner/project` form in phase 1, since the repo is public.
- Web and REST addresses always carry the owner. Only MCP has the shorthand,
  because only MCP has hand-written, committed bindings to keep working.

---

## Data Model

```sql
ALTER TABLE users ADD COLUMN slug VARCHAR(39);
CREATE UNIQUE INDEX idx_users_slug ON users(slug) WHERE slug IS NOT NULL;

CREATE TABLE project_members (
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
	added_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members(user_id);

CREATE TABLE project_invitations (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
	email VARCHAR(255) NOT NULL,          -- lowercased
	role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
	token_hash VARCHAR(64) NOT NULL UNIQUE,
	invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	expires_at TIMESTAMPTZ NOT NULL,
	accepted_at TIMESTAMPTZ,
	declined_at TIMESTAMPTZ,
	revoked_at TIMESTAMPTZ
);
-- At most one open invitation per address per project
CREATE UNIQUE INDEX idx_project_invitations_open
	ON project_invitations(project_id, email)
	WHERE accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL;
```

- **The owner is not a row in `project_members`.** `projects.owner_id` stays the
  single source of truth for ownership. It already anchors slug and key
  uniqueness (`idx_projects_owner_slug`, `idx_projects_owner_key`), and the URL
  namespace is exactly that scope. A members table that also held an `owner`
  row would give ownership two sources that could disagree.
- **Invitations follow the existing token pattern**: `generateToken` / `hashToken`
  from `shared/auth/src/tokens.ts`, only the hash stored, and a 7-day expiry.
  Rows are tombstoned (`accepted_at` / `declined_at` / `revoked_at`) rather than
  deleted, so the owner's view can show what happened.
- **User deletion** cascades memberships away. An owned project goes with its
  owner (decision 5). `items.assignee` is already `ON DELETE SET NULL`.

---

## Authorization

This is the bulk of the work and the place the BOLA class of bug (SPE-56) comes
back if it's done piecemeal.

- **One resolver.** `resolveProjectAccess(ownerSlug, projectSlug, userId)` returns
  `{ project, grantedRole, effectiveRole } | null` and replaces phase 1's
  `resolveProject` in `shared/db/src/services/projects.ts`. It is one query:
  project by `(owner slug, project slug)`, joined to the caller's membership and
  to `github_connections` for the effective role. Every REST route and every MCP
  tool resolves through it. Nothing else reads `owner_id` to make an access
  decision.
- **Routes declare a minimum role.** `requireProjectAccess` (`api/src/project-access.ts`)
  takes a `minRole` and wraps every project-scoped route, including the project
  CRUD, storage, git, sync and AI chat routes.
- **Non-members get 404**, never 403, so project existence doesn't leak. That
  matches today's behavior. Members below the required role get 403 with a
  message naming the reason (`viewer`, or `github_not_connected`; `owner_only`
  for an owner-only route, which no GitHub connection unlocks).
- **Reads switch from ownership to membership.** `getProjects` returns owned
  projects plus member projects, each tagged with the caller's role. Owner-only
  mutations (update settings, repository, folders, delete, members) keep an
  explicit owner check.
- **Tests sit at the boundary, not in the handlers.** A table-driven suite
  enumerates the registered project routes and MCP tools and runs each one as
  owner, editor, editor-without-GitHub, viewer, non-member, and logged-out,
  asserting the status. A route or tool registered without a declared minimum
  role fails the suite. That stops a new handler from silently skipping the
  check.
- **Git operations are unchanged**: commit, pull and sync run on the acting
  user's token, which is why they need an effective editor. Pending changes stay
  keyed by `(project, user)`.

---

## Invitation Flow

### Sending

The owner invites by **email** and role. There is no username lookup: it would
confirm which usernames exist, and email reaches people who don't have an
account yet.

- The response is the same whether or not the address has an account.
- Inviting an address that already belongs to a member is rejected with a clear
  message. That doesn't leak anything, since the owner can already see the
  member list.
- Re-inviting an address with an open invitation revokes the old token and sends
  a new one.
- Invites are rate-limited per owner.

The email template goes next to the others in `shared/email/src/templates.ts`:
"{inviter} invited you to {project} on Specboard as an {role}", with a link to
`/invite?token=...`.

### Accepting

`/invite` is an SSG page (`ssg/src/pages/invite.tsx`) built on the
`magic-link.tsx` pattern: an inline script reads `?token=` and looks the invite up
with a side-effect-free GET; accepting is a POST from a click, so link-prefetching mail
scanners don't consume it. The token only finds the invitation: the page's later hops
and answers go by the invitation's id. It has to be added to the public
path list in `frontend/src/index.ts` (`excludePaths`).

The invitation binds to the email address. Accepting requires being signed in
as an account whose email is that address, verified. (An account has one address,
`users.email`; the `user_emails` table this once named was dropped in migration
003.) A forwarded link can't be accepted by someone else.

| Visitor | What they see |
|---|---|
| Signed in, email matches | Invite card with **Accept** and **Decline**. Accept → `/projects/:owner/:project/planning`. |
| Signed in as a different account | "This invite was sent to k•••@example.com. You're signed in as other@example.com." **Switch account** (logs out, returns here). |
| Signed out | Invite card, then **Sign in to accept** and **Create account** side by side. The page can't say which applies without telling anyone holding the link whether the address has an account. Sign in goes to `/login?next=/invite?id=...`; Create account to signup with the invite token in place of the early-access key, the address shown masked and locked. Either way the magic link's stored `next` is `/invite?id=<invitation id>`, never the token. |
| Expired / revoked / already used | Says which, and "Ask {inviter} to send a new invite." Its own recipient, signed in, instead gets a link to the project for an invite they accepted, and is sent on to the open invite that replaced a revoked or expired one. |

Two existing flows need fixing for the no-account path:

- Signup requires an `INVITE_KEYS` key (`api/src/handlers/auth/signup.ts`). A valid
  project invitation token has to satisfy that gate.
- Onboarding always lands on `/` afterwards (`web/src/routes/onboarding/Onboarding.tsx`).
  It needs to carry `next` through, so a new user ends up on the project they
  were invited to.

### After accepting

An invitee who accepted as editor but has no GitHub connection lands on the
project in read-only mode. A banner explains why and offers **Connect GitHub**
(`GitHubConnection` flow, returning to the project).

---

## UI

The existing app has no project settings page, no avatar component, no
anonymous-to-named user display, and no read-only mode. Those gaps are most of
the UI work.

### Project settings page

Project editing moves out of the `ProjectDialog` modal into a page at
`/projects/:owner/:project/settings`. The modal is already dense, and members,
invitations and a danger zone don't fit in it. Creating a project stays a dialog.
`ProjectsList`'s `?edit=` deep link and the FileBrowser's "Open project settings"
link point at the new page, and the edit mode of `ProjectDialog` is deleted.

```
┌──────────────────────────────────────────────────────────────────┐
│ acme / roadmap                              Planning  Pages  ⚙   │
├───────────────┬──────────────────────────────────────────────────┤
│ General       │ Members                                          │
│ AI            │                                    [Invite …]    │
│ Repository    │ ┌──────────────────────────────────────────────┐ │
│ Members  ●    │ │ (DC) Dana Cho       dana@…         Owner     │ │
│ Danger zone   │ │ (AR) Alex Rivera    alex@…     [Editor ▾] ✕  │ │
│               │ │ (SM) Sam Moss       sam@…      [Editor ▾] ✕  │ │
│               │ │      ⚠ Needs GitHub to edit                  │ │
│               │ │ (JL) Jo Lee         jo@…       [Viewer ▾] ✕  │ │
│               │ ├──────────────────────────────────────────────┤ │
│               │ │ Pending                                      │ │
│               │ │ pat@example.com   Editor  expires in 5 days  │ │
│               │ │                         [Resend] [Revoke]    │ │
│               │ └──────────────────────────────────────────────┘ │
└───────────────┴──────────────────────────────────────────────────┘
```

- Non-owners can open settings and see the Members section read-only, with a
  **Leave project** button. The other sections are owner-only and hidden.
- Member status chips: **Needs GitHub to edit** (granted editor, no connection)
  and **No push access to owner/repo**.

### Invite dialog

```
┌ Invite to roadmap ─────────────────────────────┐
│ Email      [ pat@example.com              ]    │
│ Role       [ Editor ▾ ]                        │
│            Editors need their own GitHub       │
│            account connected before they can   │
│            edit. Until then they can view.     │
│ ⓘ acme/roadmap is a private repository.        │
│   Members can read its documents here.         │
│                        [Cancel]  [Send invite] │
└────────────────────────────────────────────────┘
```

### Projects list

`/projects` splits into **Your projects** and **Shared with you**. Shared cards
show the owner's avatar and name and a role badge. Open invitations addressed
to one of the signed-in user's emails appear at the top as cards with
**Accept** / **Decline**, so an invite isn't only reachable through email.

```
Invitations
┌─────────────────────────────────────────┐
│ Alex Rivera invited you to  "atlas"     │
│ as Editor              [Decline][Accept]│
└─────────────────────────────────────────┘
Your projects
[ roadmap ]  [ website ]  [ billing ]
Shared with you
[ atlas  (AR) Alex Rivera · Editor ]  [ notes  (JL) Jo Lee · Viewer ]
```

### Header

`WebHeader` shows the project as `owner / project`, with the owner part linking
to `/projects`. When the effective role is viewer it shows a **View only** badge
next to it.

### Read-only mode

The server enforces roles. The UI only avoids offering what will be refused.
One project-scoped signal carries the effective role (`useProjectRole()` →
`{ role, effectiveRole, reason }`) and components read `canEdit` from it. No
component re-derives the rules.

- **Board**: no drag-and-drop, no create buttons, item fields display as text,
  no note composer, checklist boxes disabled.
- **Documents**: the editor mounts read-only. The commit and pending-changes UI
  is hidden and comment creation is off; existing comments still render.
- **Banner**, one line under the header, stating the reason:
  - granted viewer: "You have view access. Ask {owner} for edit access."
  - editor without GitHub: "Connect GitHub to start editing." with a
    **Connect GitHub** button
  - no push access: "Your GitHub account @x can't push to owner/repo. Ask the
    repo owner to add you."

### People everywhere

Single-user assumptions surface as soon as there are two users:

- **`Avatar` component in `@specboard/ui`.** It uses `avatar_url` when set and falls
  back to initials. It replaces the three copies of `getInitials` (`UserMenu`,
  `ItemCard`, `InlineComment`).
- **Actor names.** "Created by", "Working now" and the activity log print
  "User" today, because `actorView` (`shared/db/src/views.ts`) strips everything but
  type, device and client. Actor views gain the user's display name and avatar,
  resolved server-side. User ids stay stripped, per `item-relationships.md`.
- **Assignee picker.** `items.assignee` already exists and nothing writes it.
  The item view gets a picker over the project's members (owner + members), and
  MCP `update_item` gains `assignee`. Unassigning is explicit. Removing a member
  unassigns their open items.
- **Document comments** keep their author as a name/email string in the markdown
  footer. That stays portable outside Specboard and needs no change.

### Settings and onboarding

- Onboarding: a **User slug** field under Username, pre-filled from it, with a
  live `specboard.io/projects/<slug>/…` preview.
- Settings → Personal Info: the same field, with the URL-change warning.
- Account deletion (SPE-63): before confirming, list the owner's shared projects
  and their member counts: "These projects and everything in them will be
  deleted for all members."

---

## Implementation Phases

Each phase ships on its own, and the single-user experience stays whole after
each one.

1. **User slugs and owner-namespaced addressing.** Migration and backfill,
   onboarding and settings fields, web routes, REST routes, MCP header and
   argument format, this repo's `.mcp.json`. No sharing yet, just the new
   addresses.
2. **Membership and the authorization boundary.** `project_members`,
   `resolveProjectAccess`, `minRole` on every route and tool, membership-based
   reads, and the role-matrix test suite. Seeded members make it testable before
   invites exist.
3. **Invitations.** Table, API, email template, `/invite` page, invite-token
   signup, onboarding `next`, accept/decline/revoke/resend.
4. **Project settings page and member management.** Settings page replacing the
   edit dialog, Members section, invite dialog, projects list grouping and
   invitation cards, leave project, header `owner / project`.
5. **Read-only mode and GitHub gating.** `useProjectRole`, board and editor
   read-only states, banners, push-access check.
6. **People.** `Avatar`, named actors, assignee picker and MCP `assignee`.

---

## Out of Scope

- Real-time updates, presence, draft awareness, co-editing: SPE-203.
- Ownership transfer, handoff on owner account deletion, and redirects for old
  URLs after a transfer or a user slug change: SPE-204.
- Organizations or teams as members. Membership is per user.
- Roles finer than the three above, and per-document permissions.

## Dependencies

- [Authentication](authentication.md): tokens, magic links, signup invite keys, onboarding
- [REST API & Database](api-database.md)
- [Project Storage](project-storage.md): storage modes, per-user pending changes
- [Item relationships](item-relationships.md): actor views, assignee
- SPE-63, Account deletion: inherits decision 5

## Status

Phase 1 (user slugs and owner-namespaced addressing, SPE-205) is built:
`030_user_slugs.sql`, `resolveProject(ownerSlug, projectSlug, userId)` as the single
resolver for REST and MCP (`getProjectBySlug` is gone; callers resolve, then load by
id; phase 2 replaced it with `resolveProjectAccess`), `/projects/:owner/:project/...` on web and REST, and the MCP `project` argument
with bare-slug expansion in `mcp/src/tools/project-ref.ts`. The migration backfill and
the resolver are tested against real Postgres through PGlite
(`shared/db/src/test-support/migrated-db.ts`), so CI needs no database service.

Phase 2 (membership and the authorization boundary, SPE-206) is built:

- `035_project_members.sql`, exactly the Data Model above. The owner stays
  `projects.owner_id`; `project_invitations` is phase 3.
- `resolveProjectAccess` replaced `resolveProject`: one query joining the caller's
  membership and `github_connections`. The rule that decides who can reach a project
  lives in one SQL fragment shared with `getProjects`, and `accessDenial` is the one
  comparison of a role against a requirement, for REST and MCP alike. The project
  services (`getProject`, `updateProject`, `deleteProject`, `addFolder`,
  `removeFolder`) no longer take a user id or read `owner_id`; they act on an id the
  resolver already authorized.
- Every route under `/api/projects/:owner/:project` declares its role at
  registration (`api/src/app.ts`, `api/src/planning-routes.ts`), and handlers read
  the authorized project and role off the context. AI chat moved from
  `POST /api/chat` (project in the body) to `POST /api/projects/:owner/:project/chat`
  so it sits behind the same gate. Map-baseline writes (`map/seen`) are viewer, since
  the baseline is the caller's own.
- Every MCP tool declares its role in the registry (`mcp/src/tools/index.ts`) and is
  dispatched only through it. `list_projects` and `GET /api/projects` return owned and
  member projects with `grantedRole` and `effectiveRole` (and `ownerName` on the REST
  list); API project views no longer carry `ownerId`.
- A local project is board-only for members: its files are on the owner's machine,
  so storage routes give a member no storage, and project responses send members no
  repository (its `localPath` is a path on the owner's disk).
- Item, note, blocker and worker views (`shared/db/src/views.ts`) are shared by REST and
  MCP, so no surface hands another member's agent an actor's user id, OAuth client id
  or session id. A blocker key that names no item in the project is "not found" (REST
  404) on every path, like parent and discovered-from keys.
- The member-management API (list, change role, remove, leave) is in
  [api-database.md](./api-database.md), Project Members. Members are addressed by user
  slug.
- The role-matrix suites (`api/src/role-matrix.test.ts`, `mcp/src/role-matrix.test.ts`)
  build the real app and tool registry against PGlite with seeded members, call every
  project route and tool as owner, editor, editor without GitHub, viewer, non-member,
  and logged out, and fail any route or tool without a declared role. Other packages'
  tests reach PGlite through `@specboard/db/test-support` (`pgliteAsPg` stands in for
  `pg`).

Phase 3 (invitations, SPE-207) is built:

- `036_project_invitations.sql`: the Data Model's table and one-open-invitation index,
  plus a partial index on `email` for "invitations addressed to me".
- The service is `shared/db/src/services/invitations.ts`. Tokens come from
  `generateToken`, only `hashToken`'s digest is stored, and an invitation expires 7 days
  after sending or its last resend. Invites to one project take turns on the project row
  (`FOR NO KEY UPDATE`), so concurrent invites of one address leave exactly one open
  (checked against real Postgres; PGlite is one connection).
- Routes are in [api-database.md](./api-database.md), Project Invitations. The owner's four
  (invite, pending list, resend, revoke) are owner-only and in the role matrix; the
  pending list is the one owner-only read, since it carries invitees' addresses. The
  invitee's routes (`/api/invite` by token, `/api/invitations` by id) aren't project
  routes and check the address binding instead.
- Invites are limited per inviting owner, 30 emails an hour across invite and resend.
- Accepting as an existing member stamps the invitation accepted and keeps the member's
  role; it never changes a role. Accepting as the owner, or from an account that hasn't
  onboarded (no slug), is refused and leaves the invitation open.
- The emailed token only finds an invitation. Reading and answering go by its id for the
  signed-in recipient, and every sign-in, signup and onboarding hop comes back as
  `/invite?id=...`, so the raw token is stored nowhere (only its hash, in the table).
  Signup from an invitation shows the address masked, and a typed sign-in code is sent
  with the invitation token, which names the address server-side. Token-bearing pages
  are served with `Referrer-Policy: no-referrer`.
- Accepting share-locks the project row before the invitation, so it serializes against
  inviting the same address; on real Postgres, 60 accept/re-invite races left no member
  with an open invitation, against 58 of 60 without the lock.
- The /invite page (`ssg/src/pages/invite.tsx`) shows all five states. A signed-out
  visitor gets Sign in and Create account side by side, since saying which one applies
  would tell anyone holding the link whether the address has an account; signup sends
  an existing address a sign-in link back to the invite anyway. A signed-in invitee who
  hasn't onboarded is sent to `/onboarding?next=/invite?id=...`. The lookup tells a
  signed-in visitor `addressedToYou`, so the page can show the Switch account state
  without unmasking the address. The recipient of a closed invite gets a link to the
  project they joined, or is sent on to the open invite that replaced it.
- Signup takes `invite_token` in place of an invite key ([authentication.md](./authentication.md),
  User Registration), and onboarding honors `?next=`. `next` is validated by one
  function, `safeNextPath` in `@specboard/core/next-path`, in the API and the onboarding
  page; the SSG pages share its inline twin.

Phases 4 to 6 are not built.
