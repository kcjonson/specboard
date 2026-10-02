# AI Development Overview Specification

A pannable, zoomable map of a whole project, labeled Map in the planning view toggle.
Every item is a dot. Time runs loosely from left to right: whatever was filed or
worked on long ago sits on the left, and what's happening now sits at the right
edge, so new work enters on the right and drifts left as it ages. Relationships
pull dots together: an epic gathers its children, and blockers and discovered-from
tie related work with weaker links. Most items are connected to nothing, and they
float free. Status, live agent sessions, and anything waiting on a person are drawn
on the dots.

Specboard's premise is an agent running the development loop while a person steers
by exception ([mcp-claude-workflow.md](mcp-claude-workflow.md)). Steering by
exception needs somewhere to notice the exceptions. Today that means reading three
board columns, opening drawers one at a time, and rebuilding the shape of the
project in your head. The Map does that rebuild once, visually, and keeps it
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
   or finished isn't stored anywhere. They're item fields, not Map internals: every
   item response carries them and the item view shows them. See [Data](#data).
2. **Every status transition is recorded.** One row per change of status or
   sub-status, from the day this ships. A transition nobody recorded can't be
   reconstructed later, and it's what lets
   [since your last visit](#since-your-last-visit) report a raised question or an
   opened PR.
3. **A loose time map, not a tree, a timeline, or lanes.** Position comes from a
   layout algorithm (a pull toward the item's moment in time, springs along its
   relationships, and spacing between dots) rather than from slots, columns, or
   fixed constants. Ten unrelated items in a new project are ten dots in a loose
   cloud. See [The layout](#the-layout).
4. **All relationships shape the layout.** Parent-child links are the strongest.
   Blockers and discovered-from are weaker, and are drawn faintly.
5. **Labeled Map, as a third planning view beside Board and Table.** `?view=map` on
   the planning route, picked from the same view toggle and remembered the same
   way, opening items in the same drawer ([kanban-ui.md](kanban-ui.md#item-urls)).
6. **Up next follows the agents' order.** The next ready child of each in-flight
   parent first, then the top of the project-wide ready list. See
   [Up next](#up-next).
7. **The last-visit baseline is per account**, so checking on a phone in the
   morning clears the same marks on the laptop.

### Proposed

Confirm or redline before the design pass.

8. **One project per map.** A cross-project portfolio asks different questions and
   is a different view.
9. **Read-only.** Nothing on the Map changes an item in v1. Dragging a dot to pull
   a tangle apart is allowed; it springs back on release and nothing is saved.
   Edits happen in the drawer, under its existing role rules.
10. **The default viewport is now.** The Map opens on its right edge, where
    in-flight work and most of what needs a person live. Fit-all is one key away.
11. **Polling until push exists.** Same cadence and visibility rule as the board
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

The nearest precedent for the Map's shape isn't a tracker at all.
[Obsidian's graph view](https://help.obsidian.md/plugins/graph) is a force layout
of notes, where unlinked notes float free as orphans and four forces (center,
repel, link force, and link distance) set the feel.
[Gource](https://github.com/acaudwell/Gource) grows a project's file tree
organically over time. The Map is that kind of picture, with time pulling on one
axis and the board's statuses and agents drawn on it.

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
picture of the whole graph, so the Map has to earn its place. The
[Historical Tech Tree](https://news.ycombinator.com/item?id=44829185), a giant
pannable canvas, drew exactly the complaints this one would risk: too much empty
space, no zoom, no way to jump to the next node, and a request for a vertical
layout on phones. Its author's answer was the minimap.

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

## The layout

A force simulation places every dot. This is the starting heuristic; the design
pass tunes it against real projects.

1. **Time anchor.** Each item belongs to a moment:
   - a done item: `completed_at`
   - anything else: its latest meaningful event, whichever is newest of being
     filed (`created_at`), a status or sub-status transition, an activity-log
     entry, a blocker added or cleared, and an observed agent write
   - a parent: the newest anchor anywhere in its subtree, so an epic with work
     underway sits near now with its finished children trailing back to where they
     were done

   Editing a title or description isn't an event, so fixing a typo on something
   finished last month doesn't drag it back to now. An item that stops generating
   events drifts left on its own, which makes stalled work visible without a rule
   for it.
2. **Time pull.** Each dot is pulled horizontally toward its anchor on a compressed
   scale: now at the right edge, and the further back, the more compressed (roughly
   logarithmic in age, so for example the last day is about as wide as the rest of
   the month). Bursts of agent work get room, and quiet weeks don't become empty
   canvas. The pull is soft: it sets a dot's neighborhood in time, and the other
   forces settle where exactly it sits.
3. **Links.** Parent-child links are strong, short springs, so a family clusters.
   Blocker and discovered-from links are weaker and longer: they draw related work
   toward each other without merging families.
4. **Spacing.** Dots repel each other a little and never overlap, so work that
   landed in one burst blooms into a cloud instead of stacking in a column, and
   families keep their own room.
5. **Containment.** A weak pull toward a horizontal midline keeps the Map a band
   you can scan rather than a cloud that spreads forever. Vertical position means
   nothing else.
6. **Seeded start.** A dot starts at its time anchor, at a height hashed from its
   key. Together with the simulation's fixed-seed randomness, the same data at the
   same moment produces the same map on every device.

What that produces:

- A new project's ten unrelated items: a loose cloud of ten dots near the right
  edge.
- An epic in progress: a comet, the epic and its live tasks at now and its finished
  tasks trailing back to where each was done.
- A finished epic: a compact cluster in the past, collapsed to one dot by default.
- A backlog item nobody has touched since it was filed: a lone dot out on the left.
- An in-progress task whose agent went quiet: sliding left of now, its session
  dimmed.

### Layout requirements

1. Left is earlier and right is now, everywhere on the Map. The forces can displace
   a dot from its moment but not carry it weeks away from it.
2. A time ruler (now, today, yesterday, last week, month names) runs along one edge
   at the same compression, so "roughly when" is always readable.
3. Deterministic: same data, same moment, same map, on every device.
4. Stable: an update starts from the current positions, and only the changed items
   and their neighbors move. Time drift, everything sliding left as time passes, is
   applied on refresh as a short eased step, never as continuous motion. A reload
   lands on recognizably the same map.
5. Semantic zoom with at least three levels: far (dots and faint links, labels only
   on the largest families and on anything that needs a person), middle (key and
   title on every dot, hiding labels that would collide), and near (cards with
   everything in [Status encoding](#status-encoding)). Levels switch on on-screen
   size with hysteresis, so they don't flicker at a boundary.
6. Dense: no long empty stretches, and a viewport with nothing in it offers a jump
   to the nearest dots.
7. A parent's dot grows with its subtree, sublinearly, so an epic with a hundred
   children reads as big without swallowing the Map. Its children condense at far
   zoom.
8. No fisheye or other distortion. Focus comes from dimming and collapse.
9. Holds up at ten unrelated items, at one huge epic, and at a few thousand items.

### Collapse

- Any parent collapses into its own dot, carrying its rollup; its children fold in.
- Finished families (a parent and every descendant done) start collapsed;
  everything else starts open.
- A person's expand and collapse choices persist per project on their device.

---

## Phases and up next

### Phases

Phases don't place dots; time does. They drive the summary counts, rollups,
filters, and up next. Every item is in exactly one:

| Phase | What's in it |
|---|---|
| Done | `done` |
| In flight | `in_progress` and `in_review`, blocked or not; a `blocked` hold that had started |
| Next | `ready` with no open blocker |
| Later | `ready` with an open blocker; a `blocked` hold that never started |

Next is exactly what MCP `get_items status=ready` returns (ready, blocked excluded,
by rank), which is where agents pick up work.

### Up next

The up-next marker goes on the next ready child, by rank, of each in-flight parent,
then on the top of the project-wide ready list. That's
`/specboard:whats-next`'s order: continue work that's started before picking up
new work. How many items carry the marker is the design pass's call. Since time
places dots, an up-next item filed long ago sits far left; the marker and its
off-screen indicator are what find it.

---

## What a dot shows

### Status encoding

Shape, icon, or text carries every distinction that color does; hue is never the
only signal.

- Board status, all five values.
- The sub-statuses that change what a person should do: scoping, PR open, needs
  input, paused.
- Blocked, from the derived `blocked` flag (status hold or open blocker row). What
  it's waiting on is one step away: blocking items by key, text blockers by text.
- Live agent sessions (see [Agents](#agents)).
- On a parent, a rollup of its whole subtree split by phase rather than a single
  done fraction.
- A PR link when `pr_url` is set.
- At near zoom: a linked spec, and whether an agent or a person created the item
  (`origin.actor.type`).

Board and Table show status with `StatusDot`, an 8 px dot that encodes it by hue
alone. The Map's status glyphs replace it in every view rather than living beside
it, so there's one status vocabulary. Glyphs meet 3:1 non-text contrast (WCAG
1.4.11) in both themes. The existing status tokens carry over, and the design pass
adds what blocked, needs input, and stale need.

### Relationships

- Parent-child links draw as branches between dots.
- Blocker and discovered-from links draw faintly, always. A toggle hides them.
- Selecting an item lights its whole blocker chain in both directions (what it
  waits on, transitively, and what waits on it) and its discovered-from lineage both
  ways, and dims everything else, like a path preview in a game's skill tree.
- Text blockers aren't links; they show on the dot they hold.
- Cleared blockers neither draw nor pull.
- The blockers service rejects an item blocking itself but not a longer cycle (A
  blocks B, B blocks A). A cycle shows as a deadlock, which
  [needs a person](#needs-a-person).

---

## Agents

- A live worker episode (`item_workers` with no `ended_at`) shows on its dot: client
  and device ("claude-code on dev-laptop"), branch, how long it has been on the
  item, and how long since its last observed write, so a stalled session reads
  differently from a slow one.
- Every observed write refreshes the item's time anchor, so live work sits at now
  without a rule for it.
- Several sessions on one item stack rather than overlap.
- A session with no observed write for 15 minutes dims, the threshold the drawer
  already uses
  ([item-relationships.md](item-relationships.md#workers-item_workers-migration-026)).
  An in-progress item whose only session has gone quiet is what an agent that
  crashed, or stopped updating the board, looks like.
- Calm by default. A session's indicator moves briefly when a write is observed,
  then holds still. Nothing pulses indefinitely, and no motion runs longer than
  five seconds, which also keeps the Map inside WCAG 2.2.2 without a pause control.
  The loudest treatment belongs to [needs a person](#needs-a-person).
- At far zoom, each family shows a count of its live sessions.
- A roster lists every live session in the project with the item it's on. Picking
  one flies the Map there.
- Live sessions and needs-a-person items outside the viewport get edge markers
  pointing toward them.
- The Map shows item state and session presence. It never streams tool calls.
- The browser sees the sanitized actor only (type, device name, client), as it
  does today. When People
  ([multi-user-collaboration.md](multi-user-collaboration.md#implementation-phases),
  phase 6) lands, the session's owner shows too.

---

## Needs a person

In an agent-driven loop the person is usually the bottleneck, so their queue is the
loudest thing on the Map:

- needs input (`sub_status = needs_input`), an agent's explicit question
- in review (`status = in_review` or `sub_status = pr_open`), rolled up per parent
  so the review queue shows per epic
- text blockers, which are a human hold by definition and clear only when someone
  removes them
- stale sessions
- blocker cycles

Each gets a marker that still reads at far zoom, a count in the summary, a filter,
and a key that jumps to the next one.

---

## Summary strip

Fixed, outside the Map:

- counts per phase, plus blocked and needs-a-person
- live agent sessions
- since your last visit: what changed, by kind, each of which highlights those
  items and steps through them
- freshness: when the data last refreshed

---

## Since your last visit

- A visit is the time this person spends on the Map for a project. The baseline is
  stored per account (decision 7), so it's the same on every device.
- On return, the Map marks what changed since the baseline: items completed,
  started, or created (agent-filed ones called out, with what they were discovered
  from), newly blocked or held, questions raised (`needs_input`), and PRs opened.
  The transition log is what dates the last three.
- Opening a marked item clears its mark for the rest of the visit. The baseline
  moves forward when the person leaves the Map or marks everything seen.
- Each marked item's quick card shows its latest activity-log entry, usually the
  agent's own account of what it did and why.

---

## Navigation and interaction

- Pan by dragging the background, two-finger scroll, or one-finger touch drag. Zoom
  by pinch, ctrl/cmd-wheel, on-screen controls, and keys.
- Fit all, fit to now, fit to a family, and fit to the selection. Camera flights
  are short and skippable.
- A minimap on large screens, marking the viewport, search hits, and live sessions.
- Search uses the toolbar's search and the board's matching rules (title,
  description, or key, at any depth). It dims non-matches, flies to the first hit,
  and steps through the rest.
- Filters dim what doesn't match instead of removing it, so filtering never
  re-lays out the Map: type, phase, needs a person, live sessions. Collapse is what
  saves space.
- Selecting a dot (click, or Enter on the focused one) opens the drawer, the same
  component the board uses, and lights its relationships.
- Hover or keyboard focus shows a quick card: title, status, sub-status, sessions,
  blockers, progress, and the latest activity-log entry, fetched on demand.
- Dragging a dot pulls it and its links along; on release it springs back
  (decision 9).
- Keyboard-complete, with one tab stop into the Map. Arrows move to the nearest dot
  in that direction, Enter opens, Escape closes or clears, `+`, `-`, and `0` zoom, a
  key returns to now, and keys step through needs-a-person items and live sessions.
  Focus pans the Map to keep the focused dot in view. The planning page's global
  shortcuts (`N`, `C`, `/`, `?`, Escape) keep their meanings, so Map keys can't
  reuse them ([kanban-ui.md](kanban-ui.md#keyboard-shortcuts)).
- Links anchor on an item, not on coordinates, since coordinates shift as items
  arrive: `?view=map&focus=SPE-123` reopens centered on that item. Panning replaces
  the history entry; a jump pushes one.

---

## Live updates

- The same poll as the board. The Map consumes change notifications rather than
  the poll itself, so SPE-203 can swap the transport without touching the Map.
- Changes buffer and apply at most about once a second, as a short, low-energy
  pass of the simulation started from the current positions.
- Transitions run in stages, a few hundred milliseconds each: exits, then moves,
  then entries. A status change restyles a dot in place; activity moves it toward
  now.
- Under reduced motion, changes cut in with the brief highlight the board already
  gives changed items.
- The dot under the pointer doesn't move out from under the person. If the focused
  dot moves, the viewport follows it so it stays put on screen.
- A refresh never resets the viewport, the selection, or collapse state.

---

## Data

### What's missing today

- **No start or completion time.** Items have `created_at` and `updated_at`, and
  `updated_at` moves on every edit, so it can't stand in for either.
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
   - Every item response carries both, REST and MCP alike, and the drawer and the
     standalone item view show them.
2. **A status transition log** (decision 2). One append-only row per change of
   status or sub-status: the before and after of both, the actor, and the time.
   - Written by the item service in the same transaction as the status write, on
     every path that writes one: MCP, REST, a board drag, a create that names a
     status, a status derived from `sub_status`, and the parent rollup (as a system
     actor). The activity log is deliberately separate from status writes; this log
     can't be, since a status write without its row would make since-your-last-visit
     lie.
   - `started_at` and `completed_at` are written by the same code in the same
     transaction, so they can't disagree with the log. Neither is ever accepted from
     a client payload.
   - The log starts empty. Nothing before the release is reconstructed.
3. **Best-effort backfill of the two times.** Done items take the later of their
   last worker episode's end and their last activity-log entry, else `updated_at`.
   Items that have started take their first worker episode's start, else their first
   activity-log entry, else stay empty. Times before the release are approximate
   and deliberately unflagged: the Map reads them loosely, and a flag column would
   exist only for legacy rows. The verbatim backfill expression runs read-only
   against prod before release, since staging has too little data to prove a
   backfill ([verification.md](../verification.md#when-a-manual-pass-is-required)).
4. **A time anchor per item**, computed server-side as [The layout](#the-layout)
   defines it, from data that already exists or that this spec adds: the two
   times, the transition log, activity-log entries, blocker rows, and worker
   episodes.
5. **One request for the whole project.** Every item at any depth, carrying only
   what the Map draws: key, type, title, status, sub-status, blocked, parent key,
   rank, created, started, and completed times, time anchor, live sessions
   (sanitized), open item-blocker links, text-blocker count, discovered-from key,
   origin actor type, PR URL, and spec count. No descriptions, activity log, or
   checklist.
6. **Payload budget.** 2,000 items in one response at roughly 100 KB gzipped.
7. **Cheap refresh.** A poll doesn't re-download the project. It asks for what
   changed since the last read, which `updated_at` already supports: child writes
   bump the parent and blocker writes bump the item. Deletions don't show up in an
   `updated_at` delta (the board has the same blind spot), so they need their own
   signal, and the Map reflects a deletion within a few minutes at worst.
8. **A per-account last-visit baseline** (decision 7): one timestamp per person per
   project, read when the Map opens and moved forward when they leave it or mark
   everything seen.
9. **Same read access as the board.** Any member role, viewers included.

---

## Performance

- Data to first paint under 1 s for 1,000 items on a mid-range laptop, layout
  included.
- 60 fps pan and zoom at 2,000 items on a mid-range laptop; 30 fps or better on a
  recent phone.
- The simulation runs off the main thread. A refresh never drops frames during a
  pan or zoom.
- At fit-all every dot is on screen, so culling to the viewport saves nothing there.
  The far and middle zoom levels draw one or two shapes per item; only near zoom
  draws cards.
- The Map's code loads only when the view opens, so Board and Table don't get
  heavier. Target 60 KB gzipped for the Map's chunk, layout code included; the same
  JavaScript ships to phones ([tech-stack.md](../tech-stack.md)).
- A project past the read cap still opens. Finished families come back summarized,
  and the Map says that it's summarizing.

---

## Platforms

- Every target in [shared-app-shell.md](shared-app-shell.md), with no target
  branches.
- Below 768 px time runs vertically, now at the top, so reading the Map is a scroll
  along one axis; two-axis panning across empty space is what made the Historical
  Tech Tree hard to use on a phone. Touch pan and pinch, tap opens the full-screen
  item view as the board does, no minimap, the summary strip collapses to one line,
  and controls sit within thumb reach.
- Coarse pointers get hit targets of at least 44 px at whatever zoom level makes
  dots tappable.

---

## Accessibility

- Keyboard-complete (see [Navigation](#navigation-and-interaction)).
- A parallel accessible tree in the DOM mirrors the Map: families and standalone
  items, newest anchor first, using the `tree`, `treeitem`, and `group` roles with
  `aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded`, and status in
  each item's name. The Table view stays the visible linear alternative.
- Color is never the only carrier of meaning. Text meets WCAG AA contrast and
  glyphs meet 3:1, in both themes.
- `prefers-reduced-motion` stops presence motion and turns camera flights,
  transitions, and time drift into cuts.
- Remote changes are announced through a polite live region, rate-limited, with a
  setting to turn the announcements off.

---

## Measuring it

A view nobody opens is a cost, so it reports through `@specboard/telemetry`: opens,
time on view, searches, drawer opens from the Map, roster picks, and
needs-a-person jumps. The next version gets decided on use rather than taste.

---

## Feasibility notes

Input for the technical design, not decisions.

- `d3-force` (ISC, about 5.5 KB gzipped) covers the whole heuristic: `forceX` for
  the time pull (the beeswarm technique), `forceLink` with a strength and distance
  per link type, `forceManyBody` (Barnes-Hut, so it scales to thousands of nodes),
  `forceCollide` sized per dot, and a weak `forceY` for the midline. Its simulation
  defaults to a fixed-seed random generator, which is half of the determinism
  requirement; the hashed starting positions are the other half. Starting each dot
  at its anchor puts it near its final spot, which keeps the tick count, and the
  cold-start time, down. Run it in a Web Worker.
- Alternatives if `d3-force` falls short: ForceAtlas2 through graphology (Gephi's
  organic layout, about 3 KB plus graphology), or WebCoLa (about 21 KB), whose hard
  constraints could enforce left-of-in-time if the soft pull proves too loose.
- Rendering cost is per item, not per API. In a 2018 benchmark of trees drawn at
  about 15 primitives per node, SVG and Canvas both dropped frames above roughly
  400 nodes, and WebGL held up only once text was removed
  ([Horak et al.](https://mt.inf.tu-dresden.de/cnt/uploads/Horak-2018-Graph-Performance-Poster.pdf)).
  So one Canvas 2D layer draws dots and links at far and middle zoom, and Preact
  components draw cards at near zoom, culled to the viewport (real text, real
  focus, and `@specboard/ui` reuse). `d3-zoom` (about 15 KB) runs the camera.
- Ruled out: tldraw (production use needs a license key; React-only; about
  530 KB), Excalidraw (React-only; about 350 KB), and React Flow (React-only, and a
  node editor rather than a layout engine).

Sizes are bundlephobia's min+gzip figures as of 2026-10-02.

---

## Out of scope

- Editing items on the Map: changing status, reparenting, reordering, or creating
  items in place.
- Saving dot positions a person dragged.
- A cross-project portfolio.
- Due dates, scheduling, Gantt.
- A dedicated dependency layout (a layered graph of one item's blocker chain).
- CI and merge state on items, which needs GitHub data the board doesn't hold.
- Replay of history (Gource-style) and metrics (cycle time, throughput, burn-up).
  The transition log makes both possible later.
- Push updates: SPE-203.
- Image export, public share links, and standup snapshots.
- An AI-written narrative of recent progress.
- An agent-facing rendering of the Map over MCP. The whole-project read could serve
  it later, more likely as a `get_items` parameter than a new tool, since every
  tool schema is resident context on every agent request.

## Open questions

1. Does a parent anchor at the newest activity in its subtree (the comet), or at
   its own events, leaving the epic where it was filed while its children stretch
   toward now? This spec proposes the subtree.
2. How hard should time pull against the links? Settle it on real projects in the
   design pass, where a strong pull keeps the Map honest about when and a weak one
   keeps families tight.
3. How many up-next markers?

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
