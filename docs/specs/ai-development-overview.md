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

1. **Every item gets `started_at` and `completed_at`, as part of this feature.**
   Items carry only `created_at` and `updated_at` today, so when something started
   or finished isn't stored anywhere. The status change sets them, from the day
   this ships; nothing reconstructs them for older items. They're item fields, not
   Map internals: every item response carries them and the item view shows them.
   See [Data](#data).
2. **Every status transition is recorded.** One row per change of status or
   sub-status, from the day this ships. A transition nobody recorded can't be
   reconstructed later, and it's what lets
   [since your last visit](#since-your-last-visit) report a raised question or an
   opened PR.
3. **A loose time map, not a tree, a timeline, or lanes.** Position comes from a
   layout algorithm (a pull toward the item's moment in time, springs along its
   relationships, and spacing between dots) rather than from slots, columns, or
   fixed constants. Ten unrelated items in a new project are ten dots in a loose
   cloud. Dates are the exception: finished work is strictly in the order it closed,
   and work in flight sits after all of it. See [The layout](#the-layout).
4. **All relationships shape the layout.** Parent-child links are the strongest.
   Blockers and discovered-from are weaker. They always pull, but they only draw
   for the item in focus (or with All links on): drawn faintly everywhere, they
   made the map unreadable in the design pass. An open blocker also orders: the
   blocked item sits right of what blocks it, since it can't happen first. Inside
   a family, blocked siblings form a chain that hangs off its first item, and
   chains that relate to each other pull together. A dependency stays drawn after
   it's satisfied: finishing the work doesn't erase the relation.
5. **Labeled Map, as a third planning view beside Board and Table.** `?view=map` on
   the planning route, picked from the same view toggle and remembered the same
   way, opening items in the same drawer ([kanban-ui.md](kanban-ui.md#item-urls)).
6. **Up next follows the agents' order.** The next ready child of each in-flight
   parent first, then the top of the project-wide ready list. See
   [Up next](#up-next).
7. **The last-visit baseline is per account**, so it's the same on every device.
8. **Desktop only in v1.** Below 768 px the view toggle offers Board and Table, and
   `?view=map` opened on a small screen lands on the Board. The small-screen Map is
   SPE-220; [Platforms](#platforms) keeps its requirements.
9. **One project per map.** A cross-project portfolio asks different questions and
   is a different view.
10. **Read-only.** Nothing on the Map changes an item in v1. Dragging a dot to pull
    a tangle apart is allowed; it springs back on release and nothing is saved.
    Edits happen in the drawer, under its existing role rules.
11. **The default viewport is now.** The Map opens with now at its right edge,
    where in-flight work and most of what needs a person live: at fit all when the
    whole Map fits at a readable scale (the design pass's 200-item board did),
    otherwise zoomed to the most recent stretch that does. Fit all is one key away.
12. **Polling until push exists.** Same cadence and visibility rule as the board
    (every 10 s while the window has focus) until SPE-203 replaces polling for
    both.
13. **An item with children is a region, not a dot.** With children it's more
    container than item, so it's drawn as a curved, bulbous outline fitted around
    them, with its label, status, and progress on the outline. An item with no
    children, an epic included, is a dot. See [Regions](#regions).

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
[since your last visit](#since-your-last-visit) are v1. Elsewhere "what changed"
exists only as a
digest ([Linear Pulse](https://linear.app/docs/pulse), beads_viewer's snapshot
diffs), never on the map itself.

---

## The layout

A force simulation places every dot. The design pass tuned it on a real board of
about 200 items, and its values are the [starting values](#starting-values) for the
build.

1. **Time anchor.** Each item belongs to a moment:
   - a done item: `completed_at`, or its latest event if it finished before the
     stamps existed
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
2. **Time pull.** Each dot is pulled horizontally toward its anchor, with now at
   the right edge, on a blend of two scales. One is logarithmic in age, so recent
   work gets room. The other is equalized: each stretch of time gets room in
   proportion to how much happened in it, so busy weeks spread out and quiet ones
   compress. On real data the log scale alone spent a third of the width on a
   nearly empty week; the blend (about 60% equalized) keeps the map dense. The pull
   is soft: it sets a dot's neighborhood in time, and the other forces settle where
   exactly it sits, inside the orders below.
3. **Date order.** Done items sit in the order they closed, strictly: one that
   closed earlier is never right of one that closed later, whatever the other forces
   want. In-progress and in-review items haven't closed, so they sit right of the
   last completion. After every tick a pass restores both orders with the least
   movement, so the forces still shape everything else.
4. **Links.** A parent holds its children with strong, short springs from an unseen
   center (with children, it isn't a dot), so a family clusters.
   Blocker and discovered-from links are weaker and longer: they draw related work
   toward each other without merging families.
5. **Dependencies.** Until it's done, an item sits right of everything that blocks
   it or blocked it, by at least a small gap, since it can't happen first; work
   waiting on something in flight sits past now, right of what it waits on. Once
   it's done, completion order places it. Blocker cycles can't be ordered,
   so they're exempt and show as deadlocks ([needs a person](#needs-a-person)).
6. **Chains.** Inside a family, siblings that block one another form a chain. Only
   the chain's first item keeps its link to the parent; each later item hangs off
   what blocks it, and the chain holds itself level, so it reads as a row in the
   order the work can happen. Chains whose items relate in any way (a shared
   parent, a parent-child link, a blocker, or discovered-from) pull into one band,
   a row apart, so they read as associated.
7. **Spacing.** Dots repel each other a little and never overlap, so work that
   landed in one burst blooms into a cloud instead of stacking in a column, and
   families keep their own room.
8. **Containment.** A weak pull toward a horizontal midline keeps the Map a band
   you can scan rather than a cloud that spreads forever. Vertical position means
   nothing beyond grouping.
9. **Seeded start.** A dot starts at its time anchor, at a height hashed from its
   key. Together with the simulation's fixed-seed randomness, the same data at the
   same moment produces the same map on every device.

What that produces:

- A new project's ten unrelated items: a loose cloud of ten dots near the right
  edge.
- An epic in progress: a region stretched from its live tasks at now back through
  its finished tasks, each where it was done.
- A finished epic: a compact cluster in the past, collapsed to one dot by default.
- A backlog item nobody has touched since it was filed: a lone dot out on the left.
- An in-progress task whose agent went quiet: drifting left as time passes, but
  never past the last thing finished; its session dims and it wears the
  needs-a-person ring.
- A burst of work closed in one sitting: a run of done dots in the order they
  closed, stacked where they closed close together.
- A computer picking up three items in parallel: the computer at the right edge,
  its two sessions beside it, and the three items gathered on amber lines, each
  still tied to its family.
- A chain of blocked tasks in an epic: the epic, the chain's first task, then each
  task after it a step to the right, in a row. A second chain in the same epic
  runs parallel, a row away.
- A task waiting on one an agent is working on now: past now, just right of the
  work it waits on.

### Starting values

What the prototype settled on. Distances are in layout units before the Map scales
to fit; r is a dot's radius.

| Force | Value |
|---|---|
| Time pull | Strength 0.14 toward the anchor, 0.6 of that for a parent |
| Time scale | Log of age with an 8-hour time constant, blended with the equalized scale at 60% equalized |
| Quiet break | No activity for more than 12 hours |
| Parent to child | The parent is an unseen hub with no size, no spacing, and no time pull of its own; rest length 0 to each child, strength 0.7, so children pack around it instead of ringing it |
| Blocker and discovered-from links | Rest length r1 + r2 + 70, strength 0.05 |
| Date order | After every tick, done items go back into completion order by pooling adjacent violators (the least movement that fixes an order), and in-flight items stay r + 10 right of the last completion |
| Dependencies | An unfinished item at least r1 + r2 + 10 right of each blocker, open or satisfied, enforced after every tick |
| Chain link | Rest length r1 + r2 + 16, strength 0.7, in place of the later item's parent link |
| Chain row | Strength 0.6 pulling each later item level with what blocks it |
| Related chains | Strength 0.25 toward one row apart (their largest radii plus 10) |
| Session to item | Rest length r1 + r2 + 30, strength 0.9 |
| Computer to session | Rest length r1 + r2 + 26, strength 1 |
| Repulsion | 40, ignored past 260 |
| Collision | Radii plus 4 |
| Family separation | An extra 2.5 times the repulsion between dots of different families, or a loose dot and a family, within 60; a dot's family is the region it's drawn in, so a sub-epic's children also keep apart from their grandparent's own |
| Midline | Strength 0.03 |
| Computers | Held past now and past anything waiting on in-flight work, one row each, 150 apart; the strip past now is reserved at 0.6 of the time scale's unit width, computers at half of it and sessions at a quarter |
| Velocity | 0.6 kept per tick (`d3-force` velocity decay 0.4) |
| Ticks | 280 from cold, alpha 1 decaying to 0.001; 140 for a local pass, or the width fit's second pass, from alpha 0.25 |
| Radius | 5.5 for a leaf; 6 + 2.3 times the square root of the descendant count for a parent; 8.5 for an in-flight leaf; in-flight parents 15% larger; 8 for a session, 14 for a computer |

The width the time scale maps onto is fitted in two passes so the settled Map
matches the canvas's aspect ratio. The trial width is 68 per unit of aspect, widened
by the square root of the dot count past 150, since a settled Map's area grows with
its dots. When the trial lands within 10% of the fit, it stands; otherwise the
second pass starts from the first, stretched to the fitted width, rather than from
cold. A session stays in its computer's cluster for an hour after its last write.

### Layout requirements

1. Left is earlier and right is now, everywhere on the Map. The forces can displace
   a dot from its moment but not carry it weeks away from it. Done items are
   strictly in the order they closed, work in flight sits right of all of them, and
   nothing unfinished sits left of what blocks or blocked it.
2. A ruler of dates runs along the bottom at the same scale, ticks at least 90 px
   apart, so "roughly when" is always readable. When nothing has happened for more
   than half a day, the Map ends at the last activity and the gap to now is a
   labeled break ("then quiet 6 days") instead of empty canvas. Past now there are
   no dates: what sits there is in flight or waiting on it.
3. Deterministic: same data, same moment, same map, on every device.
4. Stable: an update starts from the current positions, and only the changed items
   and their neighbors move. Time drift, everything sliding left as time passes, is
   applied on refresh as a short eased step, never as continuous motion. A reload
   lands on recognizably the same map.
5. Semantic zoom with at least three levels: far, middle, and near (cards with
   everything in [Status encoding](#status-encoding)). What each level shows is in
   [What shows when](#what-shows-when). Levels switch on on-screen size with
   hysteresis, so they don't flicker at a boundary.
6. Dense: no long empty stretches, and a viewport with nothing in it offers a jump
   to the nearest dots.
7. A region's size comes from its children. Collapsed, a parent is a dot that grows
   with its subtree, sublinearly, so a finished epic of a hundred reads as big
   without swallowing the Map.
8. No fisheye or other distortion. Focus comes from dimming and collapse.
9. Holds up at ten unrelated items, at one huge epic, and at a few thousand items.

### Regions

- An item with visible children is drawn as a region: a curved, bulbous, solid
  shape around its children, built the way Bubble Sets (Collins, Penn, and
  Carpendale, 2009) draws a set over an existing layout. Each child raises a field
  around itself and a spanning tree between the children keeps the region in one
  piece, so a long-running epic shows as bulbs on a thin neck. A closing pass
  (grow 20 px, shrink back) fills narrow inlets, so the edge stays simple, and the
  outline is traced where the field crosses a threshold. It sits loose around its
  children, not shrink-wrapped.
- A region is always one solid shape: no holes, no islands.
- Regions don't overlap. Where two unrelated regions would, each keeps the ground
  nearer its own children and they meet at a shared edge with a hairline gap. The
  layout keeps loose dots and other families out of a region with a short-range
  push between families, so the drawing never has to dent its edge around a
  stranger.
- Regions nest. A child with children of its own is a region inside its parent's,
  and each level out gets a little more padding and a slightly deeper tint.
- The label sits on the outline, at the top where there's room: the parent's status
  glyph, its title, and a short rollup bar split by phase (done, in flight, next,
  later). It takes the ink ring when the parent itself needs a person.
- Hovering a region lights its family and shows the parent's card; clicking it opens
  the parent in the drawer. Hovering a child lights its region.
- An item with no children, an epic included, is a dot.

### Collapse

- Any region collapses into a dot, carrying its rollup; its children fold in, and
  expanding turns it back into a region.
- Finished families (a parent and every descendant done) start collapsed, as one
  done dot with the family's count inside; everything else starts open.
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
new work. Three items carry the marker, numbered 1 to 3 in that order. Since time
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
- On a region's label, a rollup of its whole subtree split by phase rather than a single
  done fraction.
- A PR link when `pr_url` is set.
- At near zoom: a linked spec, and whether an agent or a person created the item
  (`origin.actor.type`).
- Weight follows the plan. Ready and blocked items draw smaller and lighter the
  further down the planning order they sit: the agents' up-next order first, then
  the board's rank order, parent before children. Lighter is a tint toward the
  surface, never opacity, which is reserved for dimming, and it stops where the
  mark still clears 3:1. Light Ready reaches that floor at 86% of its color, so
  most of the falloff is size and ring weight. The prototype tints to 35%, about
  1.5:1, which this rules out.
- In-flight items draw larger than anything around them, and an in-progress item
  always carries a label, or its computer's block names it.

Three hues carry the live work and are the same in both themes; done and blocked
step back; ink is reserved for what needs a person. Every pair was checked for
color-blind and normal-vision separation, and every mark clears 3:1 non-text
contrast (WCAG 1.4.11), against `#ffffff` and `#1a1a1a`:

| Status | Glyph | Light | Dark |
|---|---|---|---|
| Ready | hollow ring | `#3b82f6` | `#3b82f6` |
| In progress | half full | `#d97706` | `#d97706` |
| In review | three quarters full | `#c026d3` | `#c026d3` |
| Done | full, check, muted | `#5f9e86` | `#3f7a63` |
| Blocked | octagon, slate | `#64748b` | `#94a3b8` |
| Needs a person | ink ring around the dot | `#1a1a1a` | `#f0f0f0` |

Every status token but light Ready moves. In progress was `#f59e0b`, 2.15:1
against white. In review was violet `#8b5cf6`, which deuteranopes can't tell from
Ready's blue (and which sits under the normal-vision floor too). Done was `#10b981`, as
loud as the live hues. Blocked borrowed `--color-error`'s red and gets a slate token
of its own, since blocked is a state rather than an error. Dark mode lightened all
of them, and the three live hues no longer need it: each clears 3:1 against
`#1a1a1a` too. Against the app's tinted surfaces, `--color-background` and
`--color-surface-hover`, four pairs land just under 3:1: light In progress on hover
(2.86), light Done on background and hover (2.96, 2.81), and dark Done on hover
(2.85). The list views write the status beside the glyph, so none of them leans on
the glyph alone; the Map has no such label at far zoom, so it should draw on
`--color-surface` or a ground that clears these. Board, Table, child lists, and project cards draw the same glyphs
and tokens as the Map, so there's one status vocabulary. They come from
`status-glyph.ts` in `@specboard/ui`, which holds each glyph's geometry (as SVG path
data a canvas can draw with `Path2D`) and token names; the `StatusGlyph` component
and the Map's renderer both read it. Where a view has an item's derived `blocked`
flag, the glyph shows Blocked whatever the status.

### Relationships

- Parent and child aren't joined by lines: the child sits inside the parent's
  [region](#regions). A chain's links draw as hairlines inside it, in order.
- Other blocker links, and discovered-from links, draw only for the item in focus,
  or for every item while All links is on (decision 4).
- Links curve. Chain links and agent lines flow horizontally, the way time runs;
  blocker and discovered-from links arc, bowed a fifth of their length. Curves and
  regions are what let positions follow dates strictly and still read as families:
  the shapes bend so the dots don't have to.
- Selecting an item lights its whole blocker chain in both directions (what it
  waits on, transitively, and what waits on it) and its discovered-from lineage both
  ways, and dims everything else, like a path preview in a game's skill tree.
- Text blockers aren't links; they show on the dot they hold.
- A blocker that cleared because the work finished keeps drawing and pulling, in a
  lighter, satisfied style, so a finished sequence still reads as one and a chain
  keeps its shape after it's done. Only a blocker someone removed by hand
  disappears.
- The blockers service rejects an item blocking itself but not a longer cycle (A
  blocks B, B blocks A). A cycle shows as a deadlock, which
  [needs a person](#needs-a-person).

---

## What shows when

At rest the Map answers one question: where is the work. Everything else waits for
a zoom, a hover, or a click. The first design pass drew every label, link, and
marker at once and was unreadable; these rules are the fix.

| Layer | At rest, fit all | At rest, zoomed in | Hover or keyboard focus | Selected |
|---|---|---|---|---|
| Status glyph | Always. In-progress items draw larger; ready and blocked items get smaller and lighter the further down the plan they sit | Always, larger | The dot grows and gets an ink ring | Same, held until cleared |
| Labels | In-progress items first (unless their computer's block names them), in-review items if there's room, then up to 8 of the largest regions, on their outlines. Never over a dot or another label; no room, no label | Key and short title on every dot with room, in muted ink; every region with room gets its label | No extra label; the card names the item | Same |
| Regions and chains | A region around each family, its label carrying status and a rollup bar; chain links as curved hairlines inside | Same | A region or any of its children lights the family and darkens the outline | Same, and the drawer opens on the parent if the region was picked |
| Other blocker and discovered-from links | Hidden; they still pull, and a blocker still sits left of what it blocks | Hidden | The whole blocker chain both ways, discovered-from both ways (dotted) | Same |
| Everything else | Full strength | Full strength | Fades to 30% (40% on dark) | Same, and the drawer opens |
| Needs a person | Ink ring | Ring plus a reason tag | The card leads with the reason | Same |
| Up next | Numbers 1 to 3 | Same | The card says which number | Same |
| Live session | A still amber glow behind the item and its session | Same | Client, device, and time since the last write | Same |
| Computers and sessions | Each computer with a session that wrote in the last hour sits at the right edge, its sessions as numbered dots with amber lines to their items, and one text block naming them | Same, with the agent's name on each session | A computer or session lights its items; an item lights its session and computer | Same |

The detail card opens beside the item, on whichever side covers the fewest of its
related items.

---

## Agents

Work in progress clusters by where it's happening: by computer, then by agent
session. When one computer picks up several items in parallel they gather around
it, and both the computer and its sessions are on the Map.

- A computer (the agent actor's device name) is a node while any of its sessions
  has written in the last hour. Computers sit at the right edge, past now and past
  any work waiting on what's in flight, one row each. Their strip is reserved from the start, so the Map doesn't rescale when
  work begins.
- Each session is a numbered dot tied to its computer, with an amber line to every
  item it's working on. Items are pulled toward their session, so a session's
  items cluster and a computer's sessions cluster around it, while each item stays
  tied to its family. When the session goes quiet for an hour, or the item leaves
  in progress, the item is released back to its family and its moment in time.
- One text block per computer names the work: "personal-laptop", then "Session 1:
  SPE-206, SPE-209" and "Session 2: SPE-207". Items in a cluster don't get their
  own floating labels; the block names them and hover gives full titles.
- The hover card for a session, its computer, or any of its items gives the
  details: client, device, branch, how long it has been on the item, and time
  since its last write, so a stalled session reads differently from a slow one.
- Every observed write refreshes the item's time anchor, so live work sits at now
  without a rule for it.
- A session with no observed write for 15 minutes dims, the threshold the drawer
  already uses
  ([item-relationships.md](item-relationships.md#workers-item_workers-migration-026)),
  and after an hour it leaves the cluster. An in-progress item whose sessions have
  all gone quiet is what an agent that crashed, or stopped updating the board,
  looks like, and it wears the needs-a-person ring.
- Calm by default. A live session is a still amber glow behind its dot. Each
  observed write sends one ring outward from the dot and that is the only motion
  it makes; nothing loops, which also keeps the Map inside WCAG 2.2.2 without a
  pause control. The loudest treatment belongs to
  [needs a person](#needs-a-person).
- The summary strip's "Agents at work" button opens a roster grouped by computer:
  each session with the items it's on, live ones first, then quiet ones. Picking a
  row selects the item and flies the Map there.
- Live sessions and needs-a-person items outside the viewport get edge markers
  pointing toward them.
- The Map shows item state and session presence. It never streams tool calls.
- The browser sees the sanitized actor (type, device name, client) as it does
  today, plus an opaque per-session key so two sessions on one computer can be told
  apart (see [Data](#data)). When People
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

Each gets an ink ring around its dot. It's the only ink mark on the Map, so it reads
at any zoom and in either theme without competing with a status hue. Zoomed in, a
short reason tag joins the ring (? for a question, PR for review, zz for a quiet
agent, ! for a hold), and the hover card leads with the reason in full. The summary
counts them, a filter isolates them, and a key jumps to the next one.

---

## Summary strip

Fixed, outside the Map:

- counts per phase, plus blocked and needs-a-person
- live agent sessions
- since your last visit: what changed, by kind; it opens the changes view
- freshness: when the data last refreshed

---

## Loading, empty, and errors

- While the first read and layout run, the toolbar, the summary strip, and the
  ruler's frame draw; the dots arrive together once the layout settles, never one
  at a time.
- A project with no items says so on the canvas. New item works from the Map as
  from every planning view, and the first dot grows in at the right edge.
- A search or filter with no matches says so in the stepping bar and dims nothing.
- A failed first load shows the board's error state with a retry. A failed
  refresh keeps the Map as it is and turns the freshness note into "Updated 4 min
  ago, retrying".
- Past the read cap, see [Performance](#performance).

---

## Since your last visit

- A visit is the time this person spends on the Map for a project. The baseline is
  stored per account (decision 7), so it's the same on every device.
- A change is an item finished, worked on, or filed since the baseline (agent-filed
  ones called out, with what they were discovered from), newly blocked or held, a
  question raised (`needs_input`), or a PR opened. The transition log is what dates
  the last three.
- On arrival with changes waiting, the Map opens in the changes view: changed items
  at full strength, everything else dimmed, and the at-rest labels given to the
  most recent changes instead of the families. A bar on the canvas names the
  baseline ("Since your last visit, Sep 19") and steps through the changes in the
  order they happened; each step focuses the item, and its card says what changed
  and when.
- "Mark all seen" closes the view and moves the baseline forward, as leaving the
  Map does. Until then, the summary strip's "Since Sep 19: 11 finished, 1 worked
  on, 9 filed" reopens it.
- Each changed item's card shows its latest activity-log entry, usually the agent's
  own account of what it did and why.

---

## Navigation and interaction

- Pan by dragging the background, two-finger scroll, or one-finger touch drag. Zoom
  by pinch, ctrl/cmd-wheel, on-screen controls, and keys.
- Fit all, fit to now, fit to a family, and fit to the selection. Camera flights
  are short and skippable.
- A minimap appears in the lower left once zoomed in, marking the viewport. At fit
  all it would only repeat the map.
- Search uses the toolbar's search and the board's matching rules (title,
  description, or key, at any depth). It dims non-matches, labels the matches, and
  puts the changes view's stepping bar on the canvas ("Matches for "checklist", 2
  of 5"), so a match buried in a dense cluster is still one step away.
- Filters dim what doesn't match instead of removing it, so filtering never
  re-lays out the Map: type, phase, needs a person, live sessions. Collapse is what
  saves space.
- Selecting a dot (click, or Enter on the focused one) opens the drawer, the same
  component the board uses, and lights its relationships. On the Map the drawer
  overlays the right side of the canvas instead of narrowing it, and the camera
  pans just far enough to keep the selection in view. Every related item in the
  drawer (parent, children, blockers, lineage) is a link that moves the selection.
- Hover or keyboard focus shows a quick card: title, status, sub-status, sessions,
  blockers, progress, and the latest activity-log entry, fetched on demand.
- Dragging a dot pulls it and its links along; on release it springs back
  (decision 10).
- Keyboard-complete, with one tab stop into the Map; the keys are below. Focus
  pans the Map to keep the focused dot in view.
- Links anchor on an item, not on coordinates, since coordinates shift as items
  arrive: `?view=map&focus=SPE-123` reopens centered on that item. Panning replaces
  the history entry; a jump pushes one.

### Keys

The planning page's shortcuts keep their meanings, so the Map's keys stay clear of
them: `N`, `C`, `/`, `?`, Cmd+K, `M`, `E`, and `1` to `3`
([kanban-ui.md](kanban-ui.md#keyboard-shortcuts)).

| Key | Does |
|---|---|
| Arrows | Move focus to the nearest dot in that direction |
| Enter | Open the focused item in the drawer |
| Escape | Close the drawer, then clear the selection, the search, or the changes view |
| `+` and `-` | Zoom in and out around the focused dot |
| `0` | Fit all |
| `T` | Jump to now (Google Calendar's key for today) |
| `F` | Fit to the selection and its family |
| `P`, Shift+`P` | Next and previous item that needs a person |
| `L`, Shift+`L` | Next and previous live session |
| `]` and `[` | Next and previous step in the changes view or the search matches |

---

## Live updates and motion

- The same poll as the board. The Map consumes change notifications rather than
  the poll itself, so SPE-203 can swap the transport without touching the Map.
- Changes buffer and apply at most about once a second, as a short, low-energy
  pass of the simulation started from the current positions. The pass is local:
  only the changed items, their sessions and computers, and anything within two
  links of them may move; everything else is pinned. In the prototype, three
  simulated pickups moved those items, their epic, and its nearest relations, and
  left 162 of 173 dots within 4 px of where they were.
- Transitions run in stages, a few hundred milliseconds each: exits, then moves,
  then entries. A status change restyles a dot in place; activity moves it toward
  now.
- Under reduced motion, changes cut in with the brief highlight the board already
  gives changed items.
- The dot under the pointer doesn't move out from under the person. If the focused
  dot moves, the viewport follows it so it stays put on screen.
- A refresh never resets the viewport, the selection, or collapse state.

Motion only ever means something changed. Nothing loops, nothing pulses on its own,
and nothing moves for more than a second.

| When | What moves | Duration | Easing | Reduced motion |
|---|---|---|---|---|
| Hover or focus | Unrelated dots, labels, and links fade; the related set and the card appear | 150 ms | ease-out | Instant |
| A status changes | The glyph's fill sweeps to its new amount; a finished item's check draws in | 250 ms | ease-out | Instant, with the board's 2 s highlight |
| Activity arrives | The item glides to its new moment and its family settles around it; everything else holds still | 700 ms | `cubic-bezier(.2, 0, 0, 1)` | Cut |
| An agent writes | One amber ring expands out of the dot and fades; the glow stays | 900 ms, once | `cubic-bezier(.2, 0, 0, 1)` | No ring; the glow appears |
| A new item is filed | It grows out of its parent, or fades in at the right edge if it has none | 400 ms | `cubic-bezier(.2, 0, 0, 1)` | Appears, with the 2 s highlight |
| Fit all, Now, zoom | The camera moves; labels fade in or out for the new level | 450 ms | `cubic-bezier(.2, 0, 0, 1)` | Cut |
| Time passes | Everything drifts left a little, once per refresh, inside the same glide | 700 ms | `cubic-bezier(.2, 0, 0, 1)` | Cut |

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
   - The status change sets both, on every path that writes a status, the way the
     `items_updated_at` trigger sets `updated_at`. Neither is ever accepted from a
     client payload, since the web client restates the whole item on every save.
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
   - A save that restates the current status and sub-status isn't a change, and
     logs nothing. A create that names a status logs a row with no before; one left
     on the default doesn't. Shipped in migration 033; the details are in
     [item-relationships.md](item-relationships.md#status-stamps-and-transitions-migration-033).
   - The log starts empty. Nothing before the release is reconstructed.
3. **No backfill.** Items that changed status before this ships keep empty times
   rather than reconstructed ones. The Map doesn't need them: a done item without
   `completed_at` anchors at its latest event, which is how the design pass placed
   this board's history (78 of 86 done items had an activity-log entry to anchor
   on).
4. **A time anchor per item**, computed by the read from the item's own events as
   [The layout](#the-layout) defines them, from data that already exists or that
   this spec adds: the two times, the transition log, activity-log entries,
   blocker rows, and worker episodes. It's never stored; the only dates written
   are the ones a status change sets. A parent's subtree anchor is the layout's
   job, since the read carries the whole tree.
5. **One request for the whole project.** Every item at any depth, carrying only
   what the Map draws: key, type, title, status, sub-status, blocked, parent key,
   rank, created, started, and completed times, time anchor, open worker episodes
   (device name, client, branch, last write, and session key), item-blocker links
   open and cleared (with whether a clear came from finished work or from someone
   removing it), text-blocker count, discovered-from key, origin actor type, PR URL, and
   spec count. No descriptions, activity log, or checklist. The row shape is
   `MapItemRow` in `@specboard/core/map-read`, shared by the API and the layout.
6. **An opaque session key.** Browser responses strip the MCP session id today,
   and the Map has to tell two sessions on one computer apart. Each episode carries
   a key the server derives from the session (an HMAC of the session id under a
   server secret, for example): stable for the session, meaningless outside it,
   and impossible to turn back into the id.
7. **Payload budget.** 2,000 items in one response at roughly 100 KB gzipped.
8. **Cheap refresh.** A poll doesn't re-download the project. It asks for what
   changed since the last read, which `updated_at` mostly supports: child writes
   bump the parent, and note and blocker writes bump the item. Worker episodes
   don't, so the delta also carries every episode whose last write or end falls
   after the cursor. Deletions and spec links don't show up in an `updated_at`
   delta either (the board has the same blind spot), so they need their own
   signal, and the Map reflects them within a few minutes at worst.
9. **A per-account last-visit baseline** (decision 7): one timestamp per person per
   project, read when the Map opens and moved forward when they leave it or mark
   everything seen.
10. **Same read access as the board.** That's the project's owner today; once
    multi-user lands, every member role, viewers included.

---

## Performance

- Data to first paint under 1 s for 1,000 items on a mid-range laptop, layout
  included.
- 60 fps pan and zoom at 2,000 items on a mid-range laptop; 30 fps or better on a
  recent phone.
- The simulation runs off the main thread. A refresh never drops frames during a
  pan or zoom.
- The prototype ran on a second, 272-item board with a 96-child finished epic:
  272 items folded to 151 nodes, layout and first render in about 270 ms, no
  overlapping regions, and done items in strict order.
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

- v1 is desktop: 768 px and up, on every target in
  [shared-app-shell.md](shared-app-shell.md) that reaches that width, with no
  target branches. Below 768 px the Map isn't offered (decision 8).
- Coarse pointers at desktop widths (a tablet in landscape) get hit targets of at
  least 44 px at whatever zoom level makes dots tappable, and a tap stands in for
  hover: the first tap selects and shows the card, the second opens the item.
- The small-screen Map is SPE-220, and it carries these requirements: time runs
  vertically, now at the top, so reading the Map is a scroll along one axis
  (two-axis panning across empty space is what made the Historical Tech Tree hard
  to use on a phone); touch pan and pinch; tap opens the full-screen item view as
  the board does; no minimap; the summary strip collapses to one line; controls
  sit within thumb reach.

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

## Feasibility notes

Input for the technical design, not decisions.

- `d3-force` (ISC, about 5.5 KB gzipped) runs the simulation: `forceX` for the time
  pull (the beeswarm technique), `forceLink` with a strength and distance per link
  type, and a weak `forceY` for the midline. Its `forceManyBody` and `forceCollide`
  measured about 7 ms and 2 ms a tick at 1,000 nodes, far over budget, so spacing
  and collision are custom forces over a uniform grid: collision exact, and
  repulsion exact within the neighboring cells (which covers family separation) and
  summarized per cell past them, the way Barnes-Hut summarizes a quadtree. The
  simulation's random generator is fixed-seed, which is half of the determinism
  requirement; the hashed starting positions are the other half. Starting each dot
  at its anchor puts it near its final spot, which keeps the tick count, and the
  cold-start time, down. Run it in a Web Worker.
- `d3-force` has no ordering constraints. The prototype's were a few lines each,
  run after every tick: pool adjacent violators over done items sorted by
  completion (the least-squares fix for an order), a floor for in-flight items,
  and a walk over open blockers in dependency order. Chains and related chains are
  two small custom forces on `vy`.
- Curves cost one quadratic or cubic Bezier per link (`quadraticCurveTo` and
  `bezierCurveTo` on the canvas). If All links gets busy, force-directed edge
  bundling (Holten and van Wijk, 2009), computed in the worker, is the next step.
- Regions are a field sampled on a 5 px grid around each family, closed with a
  20 px disk, compared against neighboring regions' fields, and traced with
  marching squares: a few hundred lines with no dependency. The prototype's whole
  render, 14 regions included, took about 45 ms for 173 dots; outlines only change
  when positions or zoom do, so they're computed once per layout and cached.
- Alternatives if `d3-force` falls short: ForceAtlas2 through graphology (Gephi's
  organic layout, about 3 KB plus graphology), or WebCoLa (about 21 KB), whose
  separation constraints are the ordering rule built in.
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
- The app has no code splitting and no Web Worker yet, so the Map adds the first of
  each: a dynamic import for the view and a module worker for the layout.
  `shared/planning` has no package of its own, so `d3-force` and `d3-zoom` go in
  `web/package.json`, pinned like every dependency.

Sizes are bundlephobia's min+gzip figures as of 2026-10-02.

---

## Out of scope

- Editing items on the Map: changing status, reparenting, reordering, or creating
  items in place.
- Saving dot positions a person dragged.
- The Map below 768 px: SPE-220.
- A cross-project portfolio.
- Due dates, scheduling, Gantt.
- A dedicated dependency layout (a layered graph of one item's blocker chain).
- CI and merge state on items, which needs GitHub data the board doesn't hold.
- Replay of history (Gource-style) and metrics (cycle time, throughput, burn-up).
  The transition log makes both possible later.
- Push updates: SPE-203.
- Measuring the Map's use. The privacy policy says Specboard runs no analytics, and
  [logging-monitoring.md](logging-monitoring.md#future-considerations) defers
  behavior analytics until product-market fit. If that changes, the policy changes
  first, and usage events get a path of their own; `@specboard/telemetry` is the
  error pipe, and everything sent through it lands in error tracking.
- Image export, public share links, and standup snapshots.
- An AI-written narrative of recent progress.
- An agent-facing rendering of the Map over MCP. The whole-project read could serve
  it later, more likely as a `get_items` parameter than a new tool, since every
  tool schema is resident context on every agent request.

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

Requirements settled after the desktop design pass (a design canvas with a working
prototype of the layout, run on a real board of about 200 items). Not built. The
build is SPE-222: fourteen tasks in build order, each blocked by what it needs. The
small-screen Map, SPE-220, waits on it.
