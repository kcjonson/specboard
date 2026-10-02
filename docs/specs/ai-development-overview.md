# AI Development Overview Specification

A pannable, zoomable canvas that draws a whole project as one picture: every epic
and its children, laid out in the order the work happens, with what's done on one
side, what agents are working on right now in the middle, and what's next on the
other. The board answers "what's in each column"; the overview answers "where is
this project, and what is it doing".

Specboard's premise is an agent running the development loop while a person steers
by exception ([mcp-claude-workflow.md](mcp-claude-workflow.md)). Steering by
exception needs somewhere to notice the exceptions. Today that means reading three
board columns, opening drawers one at a time, and rebuilding the shape of the
project in your head. The overview does that rebuild once, visually, and keeps it
current.

---

## What it answers

Every requirement below serves one of four questions. Anything that serves none of
them doesn't belong in v1.

1. What's happening right now? Which items are in flight, which agent sessions are
   on them, which are stuck, and which are waiting on a person.
2. What's been done? Progress per epic, what finished recently, and what changed
   since I last looked.
3. What's next? The work that can start now, in the order agents will pick it up,
   and the work that can't start yet, with the reason.
4. How does it fit together? Parent and child, blocked-by, and discovered-from: the
   lineage of work agents filed while doing other work.

---

## Decisions

### Settled

1. **Every item gets `started_at` and `completed_at`, as part of this feature.**
   Items carry only `created_at` and `updated_at` today, so when something started
   or finished isn't stored anywhere, and the overview can't order its done side or
   say what changed since your last visit without both. They're item fields, not
   overview internals: every item response carries them and the item view shows
   them. See [Data](#data).

### Proposed

Confirm or redline before the design pass.

2. **One project per overview.** A cross-project portfolio asks different questions
   and is a different view.
3. **A third planning view, beside Board and Table.** `?view=overview` on the
   planning route, picked from the same view toggle and remembered the same way,
   opening items in the same drawer ([kanban-ui.md](kanban-ui.md#item-urls)). Not a
   separate route tree.
4. **Read-only canvas.** Nothing on the canvas changes an item in v1: no dragging to
   reorder, reparent, or change status. Edits happen in the drawer, under its
   existing role rules. Page-level actions (new item, search) stay where they are.
5. **Ordered by lifecycle, not scaled by calendar.** Position along the main axis
   means phase (done, in flight, next, later) and order within the phase. It
   doesn't mean elapsed time. Agent work is bursty: twenty tasks close in an
   afternoon, then nothing moves for a week, and a calendar scale would crush the
   afternoon into a sliver while spending most of the canvas on empty weeks. Only
   the past has timestamps anyway; the future is an order. Dates still appear on the
   done side, as landmarks between items ("today", "last week"), so it reads as a
   history without being a ruler.
6. **The default viewport is now.** Opening the overview centers on in-flight work,
   which is where most of what needs a person lives, not on the project's first
   epic. Fit-all is one key away.
7. **Polling until push exists.** Same cadence and visibility rule as the board
   (every 10 s while the page is visible) until SPE-203 replaces polling for both.

---

## Prior art

Surveyed 2026-10-02. The tools near this space split three ways, and none of them
puts the plan, its dependencies, and live agents on one zoomable surface.

Agent-native trackers draw the plan and leave the agents out.
[Beads](https://github.com/gastownhall/beads)' `bd graph` layers items by execution
order, so layer 0 is everything that can start now.
[beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) adds critical
path, a minimap, and a neighborhood view that grows outward from one item instead
of drawing everything at once.
[Bead Me Up, Scotty](https://github.com/brendan-appstart/bead-me-up-scotty) sorts
work into In flight, Blocked, Next up, and recently finished (this spec's phases
under other names) and marks every item as agent- or human-made.
[Task Master](https://github.com/eyaltoledano/claude-task-master)'s dashboard splits
progress bars by status instead of reducing them to a done fraction. Beads' own
graph takes 18 to 40 seconds on 200 issues because it looks dependencies up item by
item, which is the case for [one request](#data).

Orchestrators and observability tools show the agents and leave the plan out.
Conductor, Claude Squad, and [Cline Kanban](https://github.com/cline/kanban)
organize by branch or session;
[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) and
[Agent Flow](https://github.com/patoles/agent-flow) animate tool calls. The best of
them make "needs a human" the loudest thing on screen (Pixel Agents' speech
bubbles,
[AgentCraft](https://gitnation.com/contents/agentcraft-putting-the-orc-in-agent-orchestration)'s
question marks), and treat a claim with no live agent behind it as a problem
([beady-eye](https://github.com/CodeForBreakfast/beady-eye) flags claimed items with
no running agent; [Gas Town](https://github.com/gastownhall/gastown) sorts agents
into stalled and zombie). Most of them read local hooks or transcripts, so an agent
running in the cloud is invisible to them. Specboard sees every agent that writes
over MCP, wherever it runs.

Mainstream planners stop a level short. Linear's timeline shows projects, not
issues, though Linear tracks
[agent sessions per issue](https://linear.app/developers/agent-interaction), with
awaiting-input and stale among their states. GitHub's roadmap can't nest, and the
top requests on its new hierarchy view are roadmap support, filters that reach
nested items, and
[remembering what was expanded](https://github.com/orgs/community/discussions/184225).

Developers' own threads point the same way. Across more than fifteen Reddit and
Hacker News threads the most common ask is a glance that answers "is an agent
waiting on me, and is one stuck?", and in
[one overnight-run thread](https://www.reddit.com/r/ClaudeCode/comments/1vw5muy/how_do_you_get_claude_to_code_overnight/)
the warning is that a stalled run looks exactly like a slow one until morning.
Review, not generation, is the bottleneck
([Simon Willison](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/)).
Kanban is the default and wears thin: on
[Vibe Kanban's Show HN](https://news.ycombinator.com/item?id=44533004) its creator
conceded that cards move so fast half the columns feel redundant. Practitioners
plan from filtered ready and blocked lists plus a dependency tree, not from a
picture of the whole graph. The closest precedent for a giant pannable tree, the
[Historical Tech Tree](https://news.ycombinator.com/item?id=44829185), drew exactly
the complaints this canvas would risk: too much empty space, no zoom, no way to
jump to the next node, and a request for a vertical layout on phones. Its author's
answer was the minimap.

One warning runs through all of it.
[Vibe Kanban is sunsetting](https://www.vibekanban.com/blog/shutdown), Archon
dropped its task manager, Shrimp Task Manager hasn't been pushed since 2025-08, and
[DepViz](https://github.com/moul/depviz) was rebuilt around a morning brief because,
in its README's words, the point "is a useful daily answer". A graph alone doesn't
bring people back. That's why the [summary strip](#summary-strip) and
[since your last visit](#since-your-last-visit) are v1, and why the view
[measures its own use](#measuring-it). Elsewhere "what changed" exists only as a
digest ([Linear Pulse](https://linear.app/docs/pulse), beads_viewer's snapshot
diffs), never on the map itself.

---

## What's on the canvas

### Items

- Every item in the project, at any depth, all three types. The model allows any
  parenting and agents build deeper and mixed trees on purpose
  ([item-relationships.md](item-relationships.md#parent-itemsparent_id)), so the
  canvas can't assume two levels.
- Top-level items form the main sequence. A standalone task or bug sits in it as a
  smaller node with no subtree.
- Done items are included; they're half the story. They start condensed (see
  [Collapse](#collapse)).

### Phases

Every item is in exactly one phase:

| Phase | What's in it | Order |
|---|---|---|
| Done | `done` | completion time |
| In flight | `in_progress` and `in_review`, blocked or not; a `blocked` hold that had started | start time |
| Next | `ready` with no open blocker | rank, the board's own order |
| Later | `ready` with an open blocker; a `blocked` hold that never started | after whatever blocks it, rank breaking ties |

- Next is exactly what MCP `get_items status=ready` returns (ready, blocked
  excluded, by rank), which is where agents pick up work. The overview, the board's
  Ready column, and the agents agree on what's next, and a reorder on the board
  reorders Next.
- Later puts an item after the items blocking it. The blockers service rejects an
  item blocking itself but not a longer cycle (A blocks B, B blocks A), so the
  ordering can't assume there are none. A cycle must not hang the layout, and it
  shows as a deadlock, which [needs a person](#needs-a-person).
- Children are ordered by the same rules inside their parent.
- Remaining ties break by item number, so every order is total and the layout is
  deterministic.
- An in-flight item with no recorded start (only rows that predate `started_at`)
  sorts after the dated ones, by rank.

### Status encoding

Each node shows the following. Shape, icon, or text carries every distinction that
color does; hue is never the only signal.

- Board status, all five values.
- The sub-statuses that change what a person should do: scoping, PR open, needs
  input, paused.
- Blocked, from the derived `blocked` flag (status hold or open blocker row). What
  it's waiting on is one step away: blocking items by key, text blockers by text.
- Live agent sessions (see [Agents](#agents)).
- On a parent, a rollup of its whole subtree split by phase rather than a single
  done fraction.
- A PR link when `pr_url` is set.
- At item zoom: a linked spec, and whether an agent or a person created the item
  (`origin.actor.type`).

Board and Table show status with `StatusDot`, an 8 px dot that encodes it by hue
alone. The overview's status glyphs replace it in every view rather than living
beside it, so there's one status vocabulary. Glyphs meet 3:1 non-text contrast
(WCAG 1.4.11) in both themes. The existing status tokens carry over, and the design
pass adds what blocked, needs input, and stale need.

### Relationships

- Parent and child is the hierarchy itself, always visible.
- Selecting an item lights its whole blocker chain in both directions (what it
  waits on, transitively, and what waits on it) and its discovered-from lineage both
  ways, and dims everything else, like a path preview in a game's skill tree.
- A toggle shows every open blocker edge. At far zoom, edges between the same two
  top-level items bundle into one with a count. Never all of them by default: a
  project's worth of cross-links is a hairball.
- Text blockers aren't edges; they show on the item they hold.
- Cleared blockers aren't shown in v1.

### Layout requirements

The design pass picks the layout. Whatever it picks has to hold these:

1. An item's parent is unambiguous at every zoom level where the item is visible.
2. Lifecycle reads in one direction across the whole canvas. Done is always on the
   same side.
3. Deterministic: the same data lays out the same way on every load and every
   device. No force-directed physics.
4. Stable: a refresh moves only what changed and the minimum around it. Completing
   an item may carry it into Done; it may not reshuffle the rest of the project.
   Top-level order never re-sorts by activity.
5. Semantic zoom with at least three levels: the whole project (top-level items as
   shapes carrying their rollups, children as marks), a working level (titles and
   statuses readable), and item level (everything in
   [Status encoding](#status-encoding)). Levels switch on on-screen size with
   hysteresis, so they don't flicker at a boundary.
6. Detail is densest at the frontier. Long Done and Later tails condense into
   summaries that expand, and a parent with a hundred children doesn't dominate.
7. Dense: no large empty regions. A viewport with nothing in it offers a jump to
   the nearest items.
8. Orientation is never lost: while panning, which top-level item and which phase
   you're looking at stay visible.
9. No fisheye or other distortion. Focus comes from dimming and collapse.
10. Holds up with zero epics (a project of standalone tasks), with one epic, and
    with a few thousand items.

Candidate shapes for the design pass:

1. Progress lanes, the recommended starting point: a Gantt chart without dates.
   Each top-level item is a horizontal band, with its descendants nested inside as
   sub-bands, like an indented outline. Every band shares one lifecycle axis and a
   single vertical Now line, with Done to its left and In flight, Next, and Later
   to its right. Depth 2 and depth 6 lay out the same way. Most status changes move
   a card one slot across the line, which keeps a viewer's mental map intact. Dates
   appear only where they exist, on the done side. The risk is that the hierarchy
   reads as indentation rather than as a drawn tree.
2. Tree along a timeline: top-level items on a horizontal spine in phase order,
   children branching off it. It's the most literal giant tree, and the hierarchy
   reads first. But a 50-child epic becomes a comb, and every extra level of depth
   costs a lot of space.
3. Tech tree: columns by dependency depth, as in Civilization or Factorio. Blockers
   are sparse here by design (agents record them only when the dependency is
   explicit), so most items would land in the first column. Keep the vocabulary
   (Factorio's researched, available, queued, and locked map onto done, next, up
   next, and later) and drop the layout.

### Collapse

- Any parent collapses to a single node that carries its rollup.
- The default favors the present: in-flight work expanded, Done and Later
  condensed, and Next expanded up to a limit the design pass sets.
- A person's expand and collapse choices persist per project on their device.

---

## Agents

- A live worker episode (`item_workers` with no `ended_at`) shows on its item:
  client and device ("claude-code on dev-laptop"), branch, how long it has been
  on the item, and how long since its last observed write, so a stalled session
  reads differently from a slow one.
- Several sessions on one item stack rather than overlap.
- A session with no observed write for 15 minutes dims, the threshold the drawer
  already uses
  ([item-relationships.md](item-relationships.md#workers-item_workers-migration-026)).
  An in-progress item whose only session has gone quiet is what an agent that
  crashed, or stopped updating the board, looks like.
- Calm by default. A session's indicator moves briefly when a write is observed,
  then holds still. Nothing pulses indefinitely, and no motion runs longer than
  five seconds, which also keeps the canvas inside WCAG 2.2.2 without a pause
  control. The loudest treatment belongs to [needs a person](#needs-a-person).
- At far zoom, each top-level item shows a count of its live sessions.
- A roster lists every live session in the project with the item it's on. Picking
  one flies the canvas there.
- Live sessions and needs-a-person items outside the viewport get edge markers
  pointing toward them.
- The overview shows item state and session presence. It never streams tool calls.
- The browser sees the sanitized actor only (type, device name, client), as it
  does today. When People
  ([multi-user-collaboration.md](multi-user-collaboration.md#implementation-phases),
  phase 6) lands, the session's owner shows too.

---

## Needs a person

In an agent-driven loop the person is usually the bottleneck, so their queue is the
loudest thing on the canvas:

- needs input (`sub_status = needs_input`), an agent's explicit question
- in review (`status = in_review` or `sub_status = pr_open`), rolled up per parent
  so the review queue shows per epic
- text blockers, which are a human hold by definition and clear only when someone
  removes them
- stale sessions
- blocker cycles

Each gets a marker that still reads at whole-project zoom, a count in the summary,
a filter, and a key that jumps to the next one.

---

## Summary strip

Fixed, outside the canvas:

- counts per phase, plus blocked and needs-a-person
- live agent sessions
- since your last visit: completed, started, and created, each of which highlights
  those items on the canvas and steps through them
- freshness: when the data last refreshed

---

## Since your last visit

- A visit is the last time this person had the overview open for this project.
- On return, the canvas marks what changed since then: items completed, started, or
  created (agent-filed ones called out, with what they were discovered from), and
  items newly blocked by a blocker row, which carries its own `created_at`.
- A mark stays until its item is opened or everything is marked seen.
- Each marked item's quick card shows its latest activity-log entry, usually the
  agent's own account of what it did and why.
- Needs input raised, PRs opened, and status holds carry no timestamp, so v1 can't
  report them. The transition log in [open question 4](#open-questions) would.

---

## Navigation and interaction

- Pan by drag, two-finger scroll, or one-finger touch drag. Zoom by pinch,
  ctrl/cmd-wheel, on-screen controls, and keys.
- Fit all, fit to now, fit to a top-level item, and fit to the selection. Camera
  flights are short and skippable.
- A minimap on large screens, marking the viewport, search hits, and live sessions.
- Search uses the toolbar's search and the board's matching rules (title,
  description, or key, at any depth). It dims non-matches, flies to the first hit,
  and steps through the rest.
- Filters dim what doesn't match instead of removing it, so filtering never
  re-lays out the canvas: type, needs a person, live sessions. Collapse is what
  saves space.
- Selecting an item (click, or Enter on the focused one) opens the drawer, the same
  component the board uses, and lights its relationships.
- Hover or keyboard focus shows a quick card: title, status, sub-status, sessions,
  blockers, progress, and the latest activity-log entry, fetched on demand.
- Keyboard-complete, with one tab stop into the canvas. Arrows move to the nearest
  item in that direction, Enter opens, Escape closes or clears, `+`, `-`, and `0`
  zoom, a key returns to now, and keys step through needs-a-person items and live
  sessions. Focus pans the canvas to keep the focused item in view. The planning
  page's global shortcuts (`N`, `C`, `/`, `?`, Escape) keep their meanings, so
  overview keys can't reuse them
  ([kanban-ui.md](kanban-ui.md#keyboard-shortcuts)).
- Links anchor on an item, not on coordinates, since coordinates shift as items
  arrive: `?view=overview&focus=SPE-123` reopens centered on that item. Panning
  replaces the history entry; a jump pushes one.

---

## Live updates

- The same poll as the board. The canvas consumes change notifications rather than
  the poll itself, so SPE-203 can swap the transport without touching the canvas.
- Changes buffer and apply at most about once a second, and only what changed
  re-lays out.
- Transitions run in stages, a few hundred milliseconds each: exits, then moves,
  then entries. A status change recolors in place; a completion moves into Done.
- Under reduced motion, changes cut in with the brief highlight the board already
  gives changed items.
- The item under the pointer doesn't move out from under the person. If the
  focused item moves, the viewport follows it so it stays put on screen.
- A refresh never resets the viewport, the selection, or collapse state.

---

## Data

### What's missing today

- **No start or completion time.** Items have `created_at` and `updated_at`, and
  `updated_at` moves on every edit, so it can't stand in for either. Decision 1
  adds both.
- **No status history.** The activity log is prose, and status writes and log
  writes are separate on purpose
  ([item-relationships.md](item-relationships.md#activity-log-item_notes-migration-027)).
- **No whole-tree read.** List reads return top-level items with direct-child
  counts, children come one level at a time through `include_children`, and the
  list cap is 5,000 rows.
- **No project-wide workers or blockers.** Both are per-item sub-resources in the
  browser.

### Requirements

1. **`started_at` and `completed_at` on every item** (decision 1).
   - `started_at` is the first time the item entered `in_progress` or `in_review`,
     and a reopen doesn't move it. An item that goes straight from `ready` to
     `done` never started, and its `started_at` stays empty.
   - `completed_at` is the most recent entry into `done`, cleared when the item
     leaves `done`, so it's set exactly when the status is `done`.
   - Both are stamped server-side, in the item service, on every path that writes
     a status: MCP, REST, a board drag, a create that names a status, a status
     derived from `sub_status`, and the parent rollup. Like actors, they're never
     accepted from a client payload.
   - Every item response carries both, REST and MCP alike, and the drawer and the
     standalone item view show them.
2. **Best-effort backfill.** Done items take the later of their last worker
   episode's end and their last activity-log entry, else `updated_at`. Items that
   have started take their first worker episode's start, else their first
   activity-log entry, else stay empty. Times before the release are approximate
   and deliberately unflagged: the overview reads them as coarse landmarks, and a
   flag column would exist only for legacy rows. The verbatim backfill expression
   runs read-only against prod before release, since staging has too little data
   to prove a backfill
   ([verification.md](../verification.md#when-a-manual-pass-is-required)).
3. **One request for the whole tree.** Every item in the project at any depth,
   carrying only what the canvas draws: key, type, title, status, sub-status,
   blocked, parent key, rank, created, started, completed, and updated times, live
   sessions (sanitized), open item-blocker edges, text-blocker count,
   discovered-from key, origin actor type, PR URL, and spec count. No descriptions,
   activity log, or checklist.
4. **Payload budget.** 2,000 items in one response at roughly 100 KB gzipped.
5. **Cheap refresh.** A poll doesn't re-download the tree. It asks for what changed
   since the last read, which `updated_at` already supports: child writes bump the
   parent and blocker writes bump the item. Deletions don't show up in an
   `updated_at` delta (the board has the same blind spot), so they need their own
   signal, and the canvas reflects a deletion within a few minutes at worst.
6. **Same read access as the board.** Any member role, viewers included.

---

## Performance

- Data to first paint under 1 s for 1,000 items on a mid-range laptop.
- 60 fps pan and zoom at 2,000 items on a mid-range laptop; 30 fps or better on a
  recent phone.
- A refresh doesn't drop frames during a pan or zoom.
- At fit-all every item is on screen, so culling to the viewport saves nothing
  there. The far zoom levels have to draw aggregates (one or two shapes per item,
  or one per top-level item), never full cards.
- The overview's code loads only when the view opens, so Board and Table don't get
  heavier. Target 60 KB gzipped for the overview chunk, layout code included; the
  same JavaScript ships to phones ([tech-stack.md](../tech-stack.md)).
- A project past the read cap still opens. Done subtrees come back summarized, and
  the canvas says that it's summarizing.

---

## Platforms

- Every target in [shared-app-shell.md](shared-app-shell.md), with no target
  branches.
- Below 768 px: touch pan and pinch, tap opens the full-screen item view as the
  board does, no minimap, the summary strip collapses to one line, and controls sit
  within thumb reach. The main sequence is followable by scrolling one axis (a
  vertical orientation, for instance); two-axis panning across empty space is what
  made the Historical Tech Tree hard to use on a phone.
- Coarse pointers get hit targets of at least 44 px at whatever zoom level makes
  items tappable.

---

## Accessibility

- Keyboard-complete (see [Navigation](#navigation-and-interaction)).
- A parallel accessible tree in the DOM mirrors the canvas: `tree`, `treeitem`, and
  `group` roles, with `aria-level`, `aria-setsize`, `aria-posinset`, and
  `aria-expanded`, and status in each item's name. The Table view stays the
  visible linear alternative.
- Color is never the only carrier of meaning. Text meets WCAG AA contrast and
  glyphs meet 3:1, in both themes.
- `prefers-reduced-motion` stops presence motion and turns camera flights and
  transitions into cuts.
- Remote changes are announced through a polite live region, rate-limited, with a
  setting to turn the announcements off.

---

## Measuring it

A view nobody opens is a cost, so it reports through `@specboard/telemetry`: opens,
time on view, searches, drawer opens from the canvas, roster picks, and
needs-a-person jumps. The next version gets decided on use rather than taste.

---

## Feasibility notes

Input for the technical design, not decisions.

- Rendering cost is per item, not per API. In a 2018 benchmark of trees drawn at
  about 15 primitives per node, SVG and Canvas both dropped frames above roughly
  400 nodes, and WebGL held up only once text was removed
  ([Horak et al.](https://mt.inf.tu-dresden.de/cnt/uploads/Horak-2018-Graph-Performance-Poster.pdf)).
  That's why the far zoom levels draw aggregates.
- A stack that fits [tech-stack.md](../tech-stack.md)'s bias toward building our
  own and the 60 KB budget: `d3-zoom` for the camera (about 15 KB gzipped), plain
  TypeScript for the layout with `d3-hierarchy` for stratify and rollups (about
  6 KB), Preact components for cards at near zoom, culled to the viewport (real
  text, real focus, and `@specboard/ui` reuse), and one Canvas 2D layer for the far
  zoom levels.
- Ruled out: tldraw (production use needs a license key; React-only; about
  530 KB) and Excalidraw (React-only; about 350 KB). React Flow (`@xyflow/react`,
  about 60 KB) is React-only too. The repo already runs `slate-react` on
  `@preact/compat`, but nobody reports React Flow working there, so it needs a
  spike before it's a candidate.
- A dedicated dependency layout would need ELK (about 433 KB, lazy-loaded), and
  its EPL-2.0 license checked against this repo's PolyForm Noncommercial license.
  It's out of scope; selection lighting covers v1.

Sizes are bundlephobia's min+gzip figures as of 2026-10-02.

---

## Out of scope

- Editing on the canvas: dragging to reorder, reparent, or change status, and
  creating items in place.
- A cross-project portfolio.
- A calendar-scaled timeline, due dates, scheduling, Gantt.
- A dedicated dependency layout (a layered graph of one item's blocker chain).
- CI and merge state on items, which needs GitHub data the board doesn't hold.
- Replay of history and metrics (cycle time, throughput, burn-up). The new times
  make cycle time possible later; replay needs the transition log (open question
  4).
- Push updates: SPE-203.
- Image export, public share links, and standup snapshots.
- An AI-written narrative of recent progress.
- An agent-facing rendering of the tree over MCP. The whole-tree read could serve
  it later, more likely as a `get_items` parameter than a new tool, since every
  tool schema is resident context on every agent request.

## Open questions

1. Start the design pass from progress lanes?
2. Decision 5: lifecycle axis with date landmarks, or a calendar axis?
3. Last visit per device (browser storage) or per account (server)?
4. Record every status transition as well (from, to, sub-status, actor, time)? v1
   runs on the two times without it. Recommended anyway: a transition nobody
   recorded can't be reconstructed later, it's what would let since-your-last-visit
   report needs input raised, PRs opened, and holds, and replay or cycle time would
   need it.
5. What does "up next" mark: the first ready child of each in-flight parent, the
   top of the project-wide ready list, or both? It decides the frontier's look and
   where fit-to-now lands.
6. The UI label: Overview, Map, or something else.

## Dependencies

- [Item relationships](item-relationships.md): blockers, origin, workers, the
  rollup, the activity log
- [Kanban board](kanban-ui.md): the drawer, item URLs, polling windows, shortcuts
- [Claude workflow](mcp-claude-workflow.md): sub-status semantics, the
  collaboration model
- [Multi-user collaboration](multi-user-collaboration.md): who can read, People
- [Shared app shell](shared-app-shell.md): targets
- SPE-203, real-time updates

## Status

Requirements draft. Not built. Visual design next, then the ticket breakdown.
