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
- **Routes declare a minimum role.** `requireProjectAccess` (`api/src/index.ts`)
  takes a `minRole` and wraps every project-scoped route, including the project
  CRUD, storage, git and sync handlers that call services directly today.
- **Non-members get 404**, never 403, so project existence doesn't leak. That
  matches today's behavior. Members below the required role get 403 with a
  message naming the reason (`viewer`, or `github_not_connected`).
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
`magic-link.tsx` pattern: an inline script reads `?token=` and POSTs it, so
link-prefetching mail scanners don't consume it. It has to be added to the public
path list in `frontend/src/index.ts` (`excludePaths`).

The invitation binds to the email address. Accepting requires being signed in
as an account that holds that address among its `user_emails`. A forwarded link
can't be accepted by someone else.

| Visitor | What they see |
|---|---|
| Signed in, email matches | Invite card with **Accept** and **Decline**. Accept → `/projects/:owner/:project/planning`. |
| Signed in as a different account | "This invite was sent to k•••@example.com. You're signed in as other@example.com." **Switch account** (logs out, returns here). |
| Signed out, has an account | Invite card, then **Sign in to accept**, going to `/login?next=/invite?token=...` (login already honors `next`). |
| Signed out, no account | Invite card, then **Create account**. Signup uses the invite token in place of the early-access invite key, with the email pre-filled and locked. The magic link carries the invite as its `next` path. |
| Expired / revoked / already used | Says which, and "Ask {inviter} to send a new invite." |

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
  "User" today, because `apiActorView` (`api/src/types.ts`) strips everything but
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
id), `/projects/:owner/:project/...` on web and REST, and the MCP `project` argument
with bare-slug expansion in `mcp/src/tools/project-ref.ts`. The migration backfill and
the resolver are tested against real Postgres through PGlite
(`shared/db/src/test-support/migrated-db.ts`), so CI needs no database service.
Phases 2 to 6 are not built.
