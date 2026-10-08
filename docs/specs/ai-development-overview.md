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
   related chains in one family pull together. A dependency stays drawn after
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
9. **One project per map.** Several projects at once is the
   [multi-project view](multi-project-view.md), whose combined Map (SPE-249) is the
   union of each project's map: their disjoint families on one timeline, without the
   since-last-visit layer.
10. **Read-only.** Nothing on the Map changes an item in v1. Dragging a dot to pull
    a tangle apart is allowed; it springs back on release and nothing is saved.
    Edits happen in the drawer, under its existing role rules.
11. **The default viewport is now.** The Map opens with now at its right edge,
    where in-flight work and most of what needs a person live: at fit all when the
    whole Map fits at a readable scale (the design pass's 200-item board did),
    otherwise zoomed to the most recent stretch that does. Fit all is one key away.
    Readable means the smallest dot, a leaf, is at least 4 px in radius on screen
    (8 px across, about the least that still tells a ring from a half-full disc from
    a check).
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
   center (with children, it isn't a dot), so a family clusters. A done child's
   spring pulls only across time, since completion order already places it along
   time: a long-running epic is a row stretched back through its finished work,
   not a knot that pulls that work out of order.
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
   order the work can happen. Chains in the same family whose items relate (a
   blocker or discovered-from, or simply stacking as siblings) pull into one band,
   a row apart, so they read as associated. Chains in different families don't:
   region bands keep families apart, and a pull across them drags a chain out of
   its region, the region grows, the band pushes harder, and the two feed each
   other without bound (a 273-dot board reached y of ±4e8 and never finished
   tracing its outlines).
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
  closed, fanned a few units apart across about the width the burst would bloom
  to, a slanted cloud where they closed rather than a column on one x.
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
| Parent to child | The parent is an unseen hub with no size, no spacing, and no time pull of its own; rest length 0 to each child, strength 0.7, so children pack around it instead of ringing it; a done child is pulled only across time |
| Blocker and discovered-from links | Rest length r1 + r2 + 70, strength 0.05 |
| Date order | After every tick, done items go back into completion order by pooling adjacent violators, and in-flight items stay r + 10 right of the last completion. A pool fans its items evenly, in order, across twice its bloom half-width (below) around its mean, and takes in a neighbor that sits closer than that fan's step, so a burst never shares one x |
| Dependencies | An unfinished item at least r1 + r2 + 10 right of each blocker, open or satisfied, enforced after every tick |
| Chain link | Rest length r1 + r2 + 16, strength 0.7, in place of the later item's parent link |
| Chain row | Strength 3 pulling every dot of a chain to the chain's common height, so it reads level (it was 0.6 pulling each later item level with what blocked it, which left a chain sloping about 15 units a step) |
| Related chains | Strength 0.25 toward one row apart (their largest radii plus 10), only between chains under the same parent |
| Session to item | Rest length r1 + r2 + 30, strength 0.9, the pull capped at 160 so an item far from its session stays with its family; the item takes 0.7 of it, and all of a session's items together can move it by at most 50, so it stays beside its computer |
| Computer to session | Rest length r1 + r2 + 26, strength 1; the session's time target is its computer's, less that length |
| Repulsion | 40, ignored past 260 |
| Collision | Radii plus 4 |
| Family separation | An extra 2.5 times the repulsion between dots of different families, or a loose dot and a family, within 60; a dot's family is the region it's drawn in, so a sub-epic's children also keep apart from their grandparent's own |
| Region bands | Sibling regions whose stretches of time overlap are pushed apart in y, each as a whole, until their half-heights plus 50 separate their centers; strength 3. A parent with nested regions counts its own direct children as one more sibling |
| Loose dots | A dot drawn in no region keeps 20 past the extent of a top-level region's dots, in y, wherever their stretches of time meet, at the band strength; it moves alone |
| Midline | Strength 0.03 |
| Computers | Held past now and past anything waiting on in-flight work, one row each, 150 apart. The strip past now is reserved at 0.6 of the time scale's unit width, computers at half of it, only while a computer is working; a board with none ends 0.08 of a unit past now, or at its last dot |
| Velocity | 0.6 kept per tick (`d3-force` velocity decay 0.4) |
| Ticks | 280 from cold, alpha 1 decaying to 0.001; 140 for a local pass, or the width fit's second pass, from alpha 0.25 |
| Radius | 5.5 for a leaf; 6 + 2.3 times the square root of the descendant count for a parent; 8.5 for an in-flight leaf; in-flight parents 15% larger; 8 for a session, 14 for a computer |

The width the time scale maps onto is fitted in two passes so the settled Map
matches the canvas's aspect ratio. The trial width is 68 per unit of aspect, widened
by the square root of the dot count past 150, since a settled Map's area grows with
its dots, and wide enough for the stacked family bands: the most top-level families
alive at one moment, each a 40-unit row plus the band gap, times the aspect. When
the trial lands within 10% of the fit, it stands; otherwise the
second pass starts from the first, stretched to the fitted width, rather than from
cold. A session stays in its computer's cluster for an hour after its last write.

The in-flight floor and the dependency gap are minimums, not destinations. Dots
pressed against one shared floor (in-flight children whose family pulls them back,
or everything waiting on one blocker) line up on one x, a fence. So each dot one
floor holds gets its own minimum, staggered past the floor in time order over the
width the group would naturally take (half of it is sqrt(2QK / (k(k + K))) for the
group's total repulsion Q, time pull k, and midline K), and its time pull aims
there too. Held against the floor, a burst still reads as a cloud.

### Layout requirements

1. Left is earlier and right is now, everywhere on the Map. The forces can displace
   a dot from its moment but not carry it weeks away from it. Done items are
   strictly in the order they closed, work in flight sits right of all of them, and
   nothing unfinished sits left of what blocks or blocked it.
2. A ruler of dates runs along the bottom at the same scale, ticks at least 90 px
   apart, so "roughly when" is always readable. When nothing has happened for more
   than half a day, the Map ends at the last activity and the gap to now is a
   labeled break ("then quiet 6 days") instead of empty canvas. Past now there are
   no dates: what sits there is waiting on work in flight. Work in flight is happening
   now, so when a completion a moment ago holds it right of x = 0, the Now line moves
   just past the rightmost in-flight dot rather than drawing that work in the future.
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
  piece, so a long-running epic shows as bulbs on a thin neck. A parent's corridors
  include every corridor of the regions nested in it, so a nested region stretched
  across time never runs out of its parent's ground. A closing pass
  (grow 20 layout units, shrink back) fills narrow inlets, so the edge stays
  simple, and the outline is traced where the field crosses a threshold. Its
  distances are layout units, so a region scales with its dots (see the
  feasibility notes). It sits loose around its children, not shrink-wrapped.
- A region is always one solid shape: no holes, no islands.
- Regions don't overlap. Where two unrelated regions would, each keeps the ground
  nearer its own children and they meet at a shared edge with a hairline gap. The
  layout keeps loose dots and other families out of a region with a short-range
  push between families, stacks sibling families that share a stretch of time
  in bands, and keeps a loose dot out of the band of any top-level region whose stretch of
  time it is in (a weak discovered-from link can pull one toward a family member), so the
  drawing never has to dent its edge around a stranger.
- Regions nest. A child with children of its own is a region inside its parent's,
  and each level out gets a little more padding and a slightly deeper tint. The tint is a
  share of the text color: 4% for the outermost level on a light surface and 9% on a dark
  one, where the same contrast reads fainter, and a nested level adds 2.5 points (3.5 dark).
- The label sits on the outline, at the top where there's room: the parent's status
  glyph, its title, and a short rollup bar split by phase (done, in flight, next,
  later). It takes the ink ring when the parent itself needs a person, its up-next
  number (between the glyph and the title) when the parent is up next, and a lit outline
  when the parent matches a search or filter. It carries no reason tag; the card has the
  reason.
- Hovering a region lights its family and shows the parent's card; clicking it opens
  the parent in the drawer. Hovering a child lights its region.
- An item with no children, an epic included, is a dot.

### Collapse

- Any region collapses into a dot, carrying its rollup; its children fold in, and
  expanding turns it back into a region.
- Finished families (a parent and every descendant done) start collapsed, as one
  done dot with the family's count inside; everything else starts open.
- A person's expand and collapse choices persist per project on their device.
- The control is a minus at the end of a region's label and a plus on a collapsed
  dot big enough to carry one. A toggle reruns the layout as a local pass from the
  current positions, so the rest of the Map holds still and the camera stays.

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
- On the canvas the sub-status cues are shapes on the glyph: scoping dashes the
  ring (or draws a dashed ring around a solid glyph), paused swaps a ring's fill
  for two bars (or cuts them out of a solid glyph), and needs input and PR open
  take the ink ring. A small diamond at the
  lower right is the PR mark, on any item with `pr_url` or PR open. Every dot sits
  on a disc of `--color-surface`, so a region's tint never lowers its contrast.
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
| Labels | In-progress items first (unless their computer's block names them), then up to 8 of the largest regions, on their outlines, then in-review items if there's room. Never over a dot or another label; no room, no label. In the changes view, the 8 most recent changes take the regions' place | Key and short title on every dot with room, in muted ink; every region with room gets its label | No extra label; the card names the item | Same |
| Regions and chains | A region around each family, its label carrying status and a rollup bar; chain links as curved hairlines inside | Same | A region or any of its children lights the family and darkens the outline | Same, and the drawer opens on the parent if the region was picked |
| Other blocker and discovered-from links | Hidden; they still pull, and a blocker still sits left of what it blocks | Hidden | The whole blocker chain both ways, discovered-from both ways (dotted) | Same |
| Everything else | Full strength | Full strength | Fades to 30% (40% on dark) | Same, and the drawer opens |
| Needs a person | Ink ring | Ring plus a reason tag | The card leads with the reason | Same |
| Up next | Numbers 1 to 3 | Same | The card says which number | Same |
| Live session | A still amber glow behind the item and its session | Same | Client, device, and time since the last write | Same |
| Computers and sessions | Each computer with a session that wrote in the last hour sits at the right edge, its sessions as numbered dots with amber lines to their items, and one text block naming them | Same, with the agent's name on each session | A computer or session lights its items; an item lights its session and computer | Same |

The detail card opens beside the item, on whichever side covers the fewest of its
related items.

### Zoom levels

Three levels, picked by how big a leaf dot (the smallest, 5.5 layout units) is on
screen, so a 2,000-item board and a ten-item one change level when their dots look
the same size and not when their zoom factors match. Each level has a size it starts at
and a smaller one it ends at, so a camera resting on a boundary stays in whichever
level it was in:

| Level | Starts at a leaf radius of | Ends below | What it draws |
|---|---|---|---|
| Far | | | The at-rest column of the table above: in-progress and in-review labels, up to 8 region labels |
| Middle | 8 px | 7 px | Key and short title on every dot with room, every region with room gets its label |
| Near | 22 px | 19 px | A card on every item with room for one, and a one-line label (the middle level's) on each dot without; glyphs hold one size; region labels as in the middle level |

A flight that crosses two boundaries lands in the last one; there's no pause in the
middle. The near threshold is 22 px, not higher, because what decides whether a card
fits is the room around the item, not the scale: at 22 px a dense burst (leaf dots
about 60 px apart) gets compact labels and a card appears wherever the ground is
clear, and a higher threshold would only delay the cards that already have room.

Labels fade for the new level over the same 450 ms as the camera flight, on its
curve: a label both levels draw holds still, one only the new level draws fades in,
one only the old level drew fades out, and cards fade in or out the same way. Under
`prefers-reduced-motion` they cut. At rest nothing animates.

**Placement.** Every card and label at a level is placed in one pass against the same
set of taken boxes: every drawn dot (disc, ink ring, and a folded family's rollup bar),
everything already placed, the expand controls, the edge's "Now" label, the page's
own controls over the plot (the toolbar, the read-cap notice), and the minimap's
box. Nothing is ever placed over any of them: no room, no card or label. The order is
the priority: cards (in-progress first, then review, then what needs a person, then
the rest, bigger first), in-progress dot labels, regions largest first, in-review dot
labels, then every other dot, bigger first. Regions go ahead of in-review dots,
whatever the table's wording suggests: on the generated 14-region board a crowd of
in-review labels took every spot on the outlines.

A dot label takes the first of eight spots around its dot that is whole inside the
plot and clear of everything taken. A region label takes the first spot on its
outline, tried with the pill centered on it and then hanging off either side: the
outline's own top first, then a point every 10 px along the whole edge inside the
plot (the sides, both ends, every bulb), flat stretches and high ones before steep and
low ones, so the pill always straddles the outline. On the generated board that puts
all 8 allowed region labels at fit all, where taking only the top and bottom of each
outline gave 2 to 6. Text is measured with the canvas's own font metrics and cut with
an ellipsis. Text sits on a halo of the surface so it clears 4.5:1 whatever tint the
region under it has; the muted ink clears that on the surface in both themes (4.8:1
light, 6.9:1 dark), and the renderer falls back to full ink in a theme where it
doesn't. Nothing fading draws over something else fading: a label that is leaving
where a label or a card is arriving goes at once, and one that is arriving where a card
is leaving waits until that card is mostly gone. An item named by another layer (a
computer's text block) gets no label of its own at any level.

**Cards.** At the near level an item with room gets a card of real DOM over the
canvas, built from `@specboard/ui`'s `StatusGlyph`, `Badge`, and `Icon`, with its
status glyph on its dot so links still meet it. At that level every glyph is drawn at
one size whatever the scale or the item (8 px in radius, which is the 17 px the card's
SVG is), so nothing changes size when it gains or loses a card. A card is 184 px wide and exactly 92 px tall, so its box is known
before it renders, and keeps 6 px from every other card. It says the key and title
(two lines), then one row of marks: the status in words, the sub-status (scoping, PR
open, needs input, paused), what a blocked item waits on by key (text holds as a
count, since their text isn't in the Map's read), a linked spec, the PR as `PR #n`, a
folded family's size, cut to a "+N" when they don't fit the row (the rest are in the
card's text for assistive tech, and the quick card on hover lists every blocker). The corner says whether an agent or a person made the item, and the ink ring
goes on the glyph when it needs a person. A card never covers another dot's glyph,
another card, or anything on the taken list; one that doesn't fit leaves its dot as a
glyph with a one-line label, or as a bare glyph where that has no room either. A
folded family that can be opened stays a glyph with its plus control and a one-line
label, since a card would cover the control. A card
may run past the plot's own outer edge. The layer ignores the pointer: the canvas under it
hit-tests a card as it does its dot (hover, focus, click, and tap behave the same), a drag
that starts on the card's glyph pulls the dot, and a drag that starts anywhere else on the
card pans the Map, so a screen full of cards can still be panned. Cards within 48 px of
the plot are placed, at most 300, and a pan moves the one element they sit in rather
than the cards. A fade turned around halfway (zoom in, then out) goes back from the
opacity it had reached.

---

## Agents

Work in progress clusters by where it's happening: by computer, then by agent
session. When one computer picks up several items in parallel they gather around
it, and both the computer and its sessions are on the Map.

- A computer (the agent actor's device name) is a node while any of its sessions
  has written in the last hour. Computers sit at the right edge, past now and past
  any work waiting on what's in flight, one row each. The strip they sit in is held only while one is working: a board
  with no agent at work ends just past now rather than keeping empty ground, and when work begins the Map's extent grows
  to take the strip while nothing already placed rescales or moves.
- Each session is a numbered dot tied to its computer, with an amber line to every
  item it's working on. Items are pulled toward their session, so a session's
  items cluster and a computer's sessions cluster around it, while each item stays
  tied to its family. The pull is capped, so an item far from its session stays in
  its family and the line to it is long, and the session stays beside its own
  computer however its items are scattered. When the session goes quiet for an hour, or the item leaves
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
agent, ! for a hold or a deadlock), and the hover card leads with the reason in full.
The summary counts them, a filter isolates them, and a key jumps to the next one.

- An item with several reasons wears the tag of the most pressing, in the order
  above (question, deadlock, hold, review, quiet), and its card names them all.
- A family folded into one dot wears the ring for anything inside it, so a collapsed
  epic with a question under it still shows. An open family's label wears the ring
  only when the parent itself needs a person; its children carry their own.
- The count in the summary is of items, once each, whatever their reasons.

---

## Summary strip

Fixed, outside the Map:

- counts per phase, plus blocked and needs-a-person
- live agent sessions
- since your last visit: what changed, by kind ("Since Sep 19: 11 finished, 1 worked
  on, 9 filed"); it opens the changes view, and is absent when nothing is waiting, and
  while that view is open, since the bar says the same
- freshness: when the data last refreshed

The counts follow [Phases](#phases) exactly, including a started hold in In flight and
an unstarted one in Later. Blocked counts what reads Blocked, so it overlaps In flight
and Later, and it is a count only. A session is live if it wrote in the last 15
minutes, and the count is of distinct sessions. The phase, needs-a-person, and live
counts are also the filters of the same names: pressing one dims everything that
isn't in it, and pressing it again puts everything back. The "Agents at work" button
sits after the live count. Freshness reads "Updated just now" or "Updated 4 min ago"
from when the read last loaded, and keeps counting between refreshes.

The strip is one line when it fits and never drops a label to get there: the phase words
(Done, In flight, Next, Later), Blocked, Needs a person, and Live sessions are always
spelled out. When the line runs out of room, these yield in order, each keeping what the
ones before gave up:

1. The "Agents at work" button becomes its icon, the laptop the Map draws for a
   computer, with "Agents at work" as its accessible name and tooltip and its roster
   state still announced.
2. The since summary shortens to its first kind and a count of the rest ("Since Sep 23:
   86 finished, +3 more kinds"), then to a count of items ("Since Sep 23: 94 items
   changed"). Its full text is the button's title.
3. The freshness note shortens ("Updated now", "Updated 4m"); ", retrying" stays.
4. The announce switch collapses to its icon, which keeps its accessible name and its
   pressed state.
5. Only then does the strip wrap to a second line.

The strip measures its own line rather than switching at fixed widths, since what fits
depends on the counts, the since text, and the font. It starts again from the full labels
whenever its content or its width changes, so the words come back when room returns.

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

A visit is the time this person spends on the Map for a project. Everything below is
what changed since the last one, and where the Map puts it.

### The baseline

- One timestamp per account per project (decision 7), so it's the same on every device.
  It is the person's own bookmark: a single row, overwritten in place, with no history
  of visits. Nothing logs it, counts it, or reads it in aggregate, and it isn't a
  measurement of the Map's use (see [Out of scope](#out-of-scope)).
- Read when the Map opens, with the changes (below). A first visit has no baseline and
  nothing to show: the Map opens normally, and sets the baseline from that read's time
  straight away, so the next visit has one to count from.
- **The value is the read's time, never the client's clock.** The changes read stamps
  `readAt` from the database's clock before it reads anything, and the client sends it
  back unchanged. It sits a few seconds behind the statement's start on purpose: a row
  whose transaction stamped it just before the read but committed after the read's
  snapshot is then reported again next visit, where a baseline at the statement's start
  would have skipped it for good.
- **Moved forward, never back, in SQL.** The write is an upsert whose update is
  `GREATEST(stored, sent)`, which Postgres evaluates against the row's latest committed
  version once it holds the row lock, so two tabs racing each other can't leave the
  earlier one last. The sent value is also held to the database's clock
  (`LEAST(sent, clock_timestamp())`), since a client could send anything. The client
  never decides what "forward" means.
- **It moves when the person marks everything seen, and when they leave the Map**:
  switching to Board or Table, navigating away, and closing or reloading the tab.
  Closing the changes view without marking anything seen doesn't move it, and a search
  or filter doesn't either. The leave is a `fetch` with `keepalive`, sent when the Map
  unmounts and on `pagehide`. `keepalive` is what lets the browser finish the request
  after the page is gone, and it carries the CSRF token like every other write.
  `navigator.sendBeacon` can't send a header, so using it would mean taking CSRF
  protection off the route; `unload` and `beforeunload` don't fire reliably (and
  `unload` blocks the back-forward cache); `visibilitychange` fires when a tab is only
  hidden, which isn't leaving. `pagehide` is the one event a close, a reload, and a
  navigation away all fire. A leave after Mark all seen, or a second one, sends
  nothing: the client remembers the read time it has already asked for.

### What counts as a change

Each change is one item, one kind, and the time of the event that makes it. An item can
carry several kinds (finished, and a PR opened on the way); the strip counts items per
kind, and an item that carries two is in both counts.

| Kind | It's a change when | Dated by |
|---|---|---|
| Filed | The item was created after the baseline. An agent-filed one is called out, with what it was discovered from. | `created_at` |
| Finished | It is done now, and `completed_at` is after the baseline. Finished, reopened, and not finished again isn't this. | `completed_at` |
| Worked on | After the baseline it had a status or sub-status transition, an activity-log entry, or a worker write, and it wasn't filed or finished in that time (those say more). | The latest of those |
| Blocked or held | It is blocked now (status `blocked`, or an open blocker row, item or text), and after the baseline it moved to `blocked` or had a blocker opened that is still open. A blocker that opened and cleared again isn't a change. | The latest of the move and the blocker row |
| Question raised | It is in `needs_input` now, and it moved into it after the baseline. A question that was answered and moved past isn't one. | The transition log |
| PR opened | It moved into `pr_open` after the baseline. This one stands even if the item is done since: the PR is still there. | The transition log |

- A "moved into" is tested against what it moved from, so a sub-status change under a
  status that was already `blocked`, or a status move under a sub-status that was
  already `needs_input`, isn't a new hold or a new question.
- Editing a title or description isn't an event here, as it isn't for the time anchor.
- Nothing leaves out the viewer's own changes: the baseline is when they last looked at
  the Map, not when they last acted.
- No backfill: an item finished before the stamps shipped has no `completed_at`, and
  the log starts empty, so neither can be a change. Worker writes are dated by
  `last_seen_at`, and activity-log entries by their own time.
- The changes are read by the project and item indexes in one statement, never an item
  at a time.

### Where the changes ride

A request of its own, beside the Map read: `GET /api/projects/:owner/:project/map/changes`
returns the baseline, the read's time, and the changes in columns (item keys as numbers,
times as epoch milliseconds), oldest first. `POST .../map/seen` with `{ readAt }` moves
the baseline forward. Both sit behind the same access check as the Map read, so
anyone it answers 404 or 401 gets the same answer here, and the baseline is theirs alone.

They don't ride the Map read for three reasons. The read is the same for everyone and
the changes aren't. The read's own request is the critical path to first paint, and the
changes' query is extra work on it; sent beside it, both go out together, and the
changes land while the layout is still running, so they add nothing to the time before
dots draw. And the read stays a pure function of the project, which the cheap refresh
(Data, requirement 8) needs. Measured on a generated 1,000-item project, 427 changes
since a baseline a week back, on Postgres 16: the Map read takes a median 46 ms end to
end (139 KB, 19 KB gzipped), the changes read 20 ms (12.5 KB, 2.7 KB gzipped, of which
the statement is 5 to 7 ms), and both sent together finish in 50 ms, the slower of the
two rather than their sum. In the browser the changes landed about 480 ms before the
dots drew, since layout and the first paint take about 420 ms after the Map read
arrives, so first paint waits on nothing extra. Riding the Map read would have put that
statement and payload on the path every first paint waits on, to save a request nothing
was waiting for. The view's first frame already dims, because the changes are in hand
before the layout settles; a changes read slower than the layout would open the view when
it lands.

### The changes view

- **Arrival.** The Map opens in the changes view when changes are waiting, once the Map
  and the changes have both loaded; a project with no changes waiting, a first visit,
  and a failed changes read all open the Map as usual. A change that names an item the
  Map doesn't carry (filed between the two requests, or folded away past the read cap)
  is left out.
- **Changed items at full strength, everything else dimmed**, the same dimming as a
  search, and the at-rest labels go to the eight most recent changes instead of the
  families. A family's label stays only when its own parent changed. Zoomed in, where
  every dot with room is labeled anyway, nothing changes.
- **The bar** names the baseline ("Since your last visit, Sep 19") and steps through the
  changed items in the order they happened (oldest first, by each item's latest change),
  with `]` and `[`. Each step focuses the item and flies to it, and its card says what
  changed and when, a line per change ("Finished Oct 3, 3:12 PM"; an agent-filed item
  says who filed it and what it was discovered from), above its latest activity-log
  entry. The card shows the same lines when the pointer is on a changed item.
- **Mark all seen** closes the view and moves the baseline to the read's time. **Close**
  closes the view and leaves the baseline where it was; Escape does what Close does,
  once the drawer, the selection, and any search or filter have had their turn.
- **Reopening.** While changes are waiting and the view is closed (or a search has the
  canvas), the strip says "Since Sep 19: 11 finished, 1 worked on, 9 filed" (every kind
  that has any, in this order: finished, worked on, filed, blocked, questions, PRs
  opened). Pressing it reopens the view and moves focus to the view's bar. While the
  view is open the strip leaves it out, since the bar names the baseline and the count.
  After Mark all seen nothing is waiting, and it's gone.
- **A search or filter takes the canvas while it's on**, with its own bar and its own
  dimming; the changes view stays open behind it and comes back when the search ends.
- **Each changed item's card shows its latest activity-log entry**, usually the agent's
  own account of what it did and why.

---

## Navigation and interaction

- Pan by dragging the background, two-finger scroll (a plain mouse wheel pans the
  same way), or one-finger touch drag. Zoom by pinch, ctrl/cmd-wheel, on-screen
  controls, and keys. Zooming out stops at fit all, and panning stops when the
  middle of the plot reaches the edge of the Map.
- Fit all, fit to now, fit to a family, and fit to the selection. Camera flights
  are short and skippable. Fit to now puts the right edge of the Map against the
  plot's, zoomed in to at least 2.4 times fit all, so it differs from the opening
  view only when the whole Map fit at that view.
- A minimap appears in the lower left once zoomed in, marking the viewport. At fit
  all it would only repeat the map, so it shows from 1.2 times fit all and hides again
  below 1.1. It is the whole Map in miniature, at most 200 by 112 px in the Map's
  own shape, with a speck per dot in its status color. Its box is reserved: labels
  are placed around it, and it sits above the cards. Clicking it flies the camera to
  that point at the current scale, and dragging in it moves the camera with no
  flight. It takes keyboard focus, and the arrow keys move the view by a quarter of
  the plot; a target past the Map's edge is held to the edge, as a pan is.
- Search uses the toolbar's search and the board's matching rules (title,
  description, or key, at any depth). It dims non-matches, labels the matches, and
  puts the changes view's stepping bar on the canvas ("Matches for "checklist", 2
  of 5"), so a match buried in a dense cluster is still one step away. The Map's read
  carries no descriptions, so the matching is the board's own: once the box has
  settled (the board's debounce), the Map asks the items list for the keys that match
  and lights those. A parent drawn as a region that matches gets a lit outline, and a
  match inside a folded family lights the family's dot.
- Filters dim what doesn't match instead of removing it, so filtering never
  re-lays out the Map: type, phase, needs a person, live sessions. Collapse is what
  saves space. Type is the toolbar's type filter; the other three are the summary
  strip's counts. A search and the filters together narrow: an item has to pass
  every one that is on.
- The stepping bar steps through what is lit, in reading order (left to right across
  the Map), and a step focuses the item and flies to it. With only filters on, the
  bar reads "Filtered: needs a person" and steps the same way. `]` and `[` do what
  its arrows do, wrapping at the ends. Clear, or Escape once the drawer and the
  selection are closed, ends the search and every filter.
- While a search or filter is on, hovering or focusing an item lights its family on top
  of what the search lit, so nothing the search lit goes dim.
- Selecting a dot (click, or Enter on the focused one) opens the drawer, the same
  component the board uses, and lights its relationships. On the Map the drawer
  overlays the right side of the canvas instead of narrowing it, and the camera
  pans just far enough to keep the selection in view. Every related item in the
  drawer (parent, children, blockers, lineage) is a link that moves the selection.
- Hover or keyboard focus shows a quick card: title, status, sub-status, sessions,
  blockers, progress, and the latest activity-log entry, fetched on demand.
- Dragging a dot pulls it and its links along; on release it springs back
  (decision 10). The pull is a client-side displacement of the dot, its
  links, and its card (its label stays behind); nothing re-runs the layout and nothing is saved. It
  springs back over 300 ms with a small overshoot, and cuts under reduced motion. A drag
  on the background pans, a press has to move 4 px (10 px on touch) to be a drag rather
  than a click, and a finger always pans: dragging dots is for mouse and pen.
- One hit test serves every pointer. A control beats a dot, a dot beats a card's body,
  a card's body beats a region's label, a label beats the region's ground, and the
  innermost region wins. It is made at the sizes the last frame drew, and not at all
  while the camera is moving (it looks at the pointer again once the camera has been
  still for 120 ms), so a pan or zoom never pays for hit testing. A fine pointer reaches
  a dot from 6 px at least, since a leaf at fit all is 2 px; a coarse one (a touch
  pointer) reaches it, and a collapse control, from 22 px, which is a 44 px target.
- Hover leads over keyboard focus, which leads over the selection: the pointer on
  something lights it, and with the pointer off everything the focus or selection holds.
  Escape closes the drawer first, and a second Escape clears the selection, as a click
  on the empty plot does; a dialog or a field that has the key keeps it.
- The quick card opens 150 ms after the pointer settles on an item (so sweeping across
  dots opens none), at once for keyboard focus, and for the selection when the drawer
  isn't already showing it (a coarse pointer's first tap). It sits beside the item on the
  side that covers the fewest related items, never under the toolbar, the minimap, or the
  drawer, keeping off the label of the item's own region when another side is as good, and
  takes no pointer. Its sessions line is the open agent sessions the read
  carries; text blockers show there as a count and on the dot as the ink ring, since the
  read has no text. The latest activity entry comes from the item's notes, fetched when
  the card opens (the newest entry only: the notes read takes `?limit=1`) and kept for the
  life of the view.
- The selection is the item URL: `/planning/items/:key?view=map` opens that item in the
  drawer with it selected, and a related item chosen in the drawer moves it. The drawer
  overlays the plot, and selecting pans only as far as keeps the item 56 px inside the
  part the drawer leaves clear.
- Keyboard-complete, with one tab stop into the Map; the keys are below. Focus
  pans the Map to keep the focused dot in view.
- Links anchor on an item, not on coordinates, since coordinates shift as items
  arrive: `?view=map&focus=SPE-123` reopens centered on that item. Panning replaces
  the history entry: once a pan or zoom settles, `focus` names the item nearest the
  middle of the plot. A jump pushes one: Fit all and Now drop `focus`, and a jump to
  a dot sets it. Back and Forward move the camera to the entry's item, or to the
  opening view when it has none.

### Keys

The planning page's shortcuts keep their meanings, so the Map's keys stay clear of
them: `N`, `C`, `/`, `?`, Cmd+K, `M`, `E`, and `1` to `3`
([kanban-ui.md](kanban-ui.md#keyboard-shortcuts)).

The Map has one tab stop, and its keys are heard only while that stop has focus: the
accessible tree holds it (see [Accessibility](#accessibility)). A click on the canvas
puts focus there, so the keys work from the first click. Nothing is heard from the
page around it, from a field, or with Cmd or Ctrl held. Two keys are the exceptions:
Escape works from anywhere, as the board's does, and `Z` works wherever focus is while
the pointer is over the canvas, since the hand on the mouse is the one asking. Tabbing in lands on the item focus was last on, or on
the dot nearest the middle of the plot; focus going elsewhere puts the Map's own away,
so no card stays open for a keyboard that has left.

| Key | Does |
|---|---|
| Arrows | Move focus to the nearest dot or region label in that direction: the nearest within 45 degrees of the arrow, where the distance across counts double, and the nearest of everything ahead when that cone is empty. Focus stops at the last one rather than wrapping. The Map pans just far enough to keep it in view |
| Enter | Open the focused item in the drawer; on a region's label, its parent |
| Escape | Close the drawer, then clear the selection, the search, or the changes view |
| `+` and `-` | Zoom in and out around the focused dot |
| `Z` held | Figma's zoom tool: the cursor turns to a magnifier, and a click zooms in by the same step as `+` and `-` and brings the point clicked to the middle of the plot; with Option held too, the cursor and the click zoom out. A drag still pans, and no dot drags. It answers while the pointer is over the canvas wherever focus is, never in a field or with Cmd or Ctrl held (Cmd+`Z` stays undo), and letting go of Z, or the window losing focus, puts it away |
| `0` | Fit all |
| `T` | Jump to now (Google Calendar's key for today) |
| `F` | Fit the focused item (the selection, with nothing focused) and its family into the part of the plot the drawer leaves clear |
| `P`, Shift+`P` | Next and previous item that needs a person, left to right, wrapping |
| `L`, Shift+`L` | Next and previous live session, wrapping |
| `]` and `[` | Next and previous step in the changes view or the search matches |
| Shift+Left, Shift+Right | The tree's collapse and expand, which plain arrows can't be since they move in space. On a region, Left folds it; on a dot, it goes up to its region. On a folded family, Right opens it; on a region, it goes down to its first dot |

`P` and `L` with nothing to step through say so in the live region.

---

## Live updates and motion

- The same poll as the board, from one shared hook: every 10 s while the window has
  focus, skipped while the Map is in its error state. A failed refresh keeps the Map
  as it was, says "retrying", and waits twice as long before each next try, up to
  160 s. The Map consumes change notifications rather than the poll itself, so
  SPE-203 can swap the transport without touching the Map.
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
- The dot under the pointer doesn't move out from under the person: it stays where it
  was until the pointer leaves it, then glides. If the focused or selected dot moves
  (and the pointer isn't on one), the viewport follows it so it stays put on screen.
- Regions follow their children by crossfading from the old outline to the new one
  over the glide, and each region's label glides from where it stood to where the new
  outline puts it on the same curve; tracing outlines every frame is too slow (see the
  feasibility notes).
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
5. **One request for the whole project.** `GET /api/projects/:owner/:project/map`,
   beside the items list and behind the same access check. Every item at any depth,
   carrying only what the Map draws: key, type, title, status, sub-status, blocked,
   parent key, rank, created, started, and completed times, time anchor, open
   worker episodes (device name, client, branch, the episode's start, last write, and
   session key),
   item-blocker links, text-blocker count, discovered-from key, origin actor type,
   PR URL, and spec count. No descriptions, activity log, or checklist. The row
   shape is `MapItemRow` in `@specboard/core/map-read`, shared by the API and the
   layout.
   - An item-blocker link comes back open, or satisfied with when it cleared, if
     the system cleared it because work finished (`blocking_item_done` or
     `item_completed`). A link someone removed by hand doesn't come back at all.
     Each pair resolves to its latest row, so a dependency that was satisfied,
     re-added, and then removed by hand is gone.
   - Origin actor type is null for an item filed before provenance was recorded
     (migration 025); nothing says who filed it.
   - Discovered-from resolves through the source item's id to its current key, and
     is null once the source is deleted.
   - The anchors, links, and episodes are aggregated per item in one statement for
     the whole project, never looked up item by item.
6. **An opaque session key.** Browser responses strip the MCP session id today,
   and the Map has to tell two sessions on one computer apart. Each episode carries
   a key the server derives from the session: SHA-256 of the same user, OAuth
   client, and session id that key the episode's row, encoded as a JSON array so no
   choice of characters in one id can shift into the next, truncated to 96 bits (16
   base64url characters), where a collision between two sessions on one project is
   out of reach. There's no server secret. The session id is a random UUID the MCP
   server mints at initialize, and under the stateless transport it's a correlation
   token, not a credential, so a plain hash of it is already infeasible to reverse;
   a key would add an infra dependency and buy nothing. Stable for the session,
   different for a second session on the same computer, and meaningless outside.
7. **Payload budget.** 2,000 items in one response at roughly 100 KB gzipped. The
   read goes out in columns (`MapReadWire`: one array per field, keys as numbers
   under the project key, times as epoch milliseconds), and `decodeMapRead` turns
   it back into rows. On a generated 2,000-item project that's 73 KB gzipped,
   where an array of row objects took 106 KB. The API gzips the response itself,
   since nothing in front of it does.
8. **Cheap refresh.** A poll doesn't re-download the project. It asks for what
   changed since the last read, which `updated_at` mostly supports: child writes
   bump the parent, and note and blocker writes bump the item. Worker episodes
   don't, so the delta also carries every episode whose last write or end falls
   after the cursor. Deletions and spec links don't show up in an `updated_at`
   delta either (the board has the same blind spot), so they need their own
   signal, and the Map reflects them within a few minutes at worst. The cursor is
   the server's, never the client's clock, and is held back rather than risk a
   missed write; see the feasibility notes (SPE-235).
9. **A per-account last-visit baseline** (decision 7): one timestamp per person per
   project (`map_baselines`, migration 034), read when the Map opens and moved forward
   when they leave it or mark everything seen. It moves forward only, enforced in SQL,
   to the read's time and not the client's clock, and it is the person's own bookmark
   rather than usage data. The changes since it come from a request of their own,
   `GET /map/changes`, and the baseline moves with `POST /map/seen`. See
   [Since your last visit](#since-your-last-visit).
10. **Same read access as the board.** That's the project's owner today; once
    multi-user lands, every member role, viewers included. The baseline routes sit
    behind the same check, and a baseline is only ever its owner's.

---

## Performance

Budgets, each with what the last pass (SPE-238) measured. Chrome at 1x, 1280 by 800, on a
2019 Intel MacBook with a load average of 5 to 8 from other work and the stack's own
containers, the production build served gzipped from a local server, a board of the
generated kind (the layout tests' `syntheticBoard`: half its epics finished and folded,
the rest open) unless it says otherwise. Frame times come from a script that sends one
wheel event per frame for eight seconds.

- **Data to first paint under 1 s for 1,000 items**, layout included. From the read landing
  to the first dot drawn: a median of 432 ms over five loads of a generated 1,000-item board
  (the worker 370 ms of it), 836 ms on the harder 1,000-item shape of 40 open epics of 20 tasks
  each (the worker 660 to 860 ms, three loads). The dev server, unminified and with the worker
  loaded as separate modules, adds about 120 ms. Larger boards, for scale: 793 ms at 2,000
  items, 1,276 ms at 3,000, and 1,273 ms for a 5,460-item project past the read cap (dev server).
- **60 fps pan and zoom at 2,000 items.** On the generated 2,000-item board the median frame
  is 16.6 to 17.6 ms in every view (58 to 60 fps), and the 95th percentile 18.5 to 26.5 ms,
  at the opening view, fit all, the middle level, and near. A frame over 50 ms comes a few times
  per eight seconds of continuous input, worst 230 ms (a zoom through the middle and near
  boundaries at the opening view; a pan at the middle level); the script is
  mostly idle in them. The stress shape of 80 open families whose 2,000 dots are all on screen at fit all
  (the layout tests' worst case) pans at 58 fps at its opening view and at the middle level but
  36 fps at fit all, and a zoom through fit all runs 18 to 20 fps, which stays a miss.
  These were taken on d3-zoom. The hand-rolled camera that replaced it, run back to back against
  it on the same board and machine, gave the same medians (16.6 to 17.4 ms for pan and zoom at the
  opening view and fit all, against d3's 16.7 to 17.2; one pan under heavier load, 18.8), and its
  wheel handler costs 0.11 to 0.24 ms an event against d3's 0.18 to 0.36.
  30 fps on a recent phone has not been measured.
- **The simulation runs off the main thread, and a refresh never drops frames during a pan or
  zoom.** Three pickups landing while a 1,000-item board was being panned: the delta read came
  back at 811 bytes, the worker answered 170 to 190 ms later, one frame of 50 ms drew where the
  new layout landed, and every other frame in the 40 s were the pan's own (median 16.7 ms, none
  over 60). The same refresh on the 40-epic shape took the worker 630 ms, with a 43 ms landing
  frame; on the 80-epic stress shape 1.9 s in the worker and a 46 ms frame. Outline tracing for
  a zoom into a finer grid step also runs in the worker now, and its answer travels as
  transferred buffers.
- The prototype ran on a second, 272-item board with a 96-child finished epic:
  272 items folded to 151 nodes, layout and first render in about 270 ms, no
  overlapping regions, and done items in strict order. The same board's structure (anonymized)
  is now a fixture the layout tests run at four canvas aspects, and the layout takes 37 ms on it
  in Node.
- At fit-all every dot is on screen, so culling to the viewport saves nothing there.
  The far and middle zoom levels draw one or two shapes per item; only near zoom
  draws cards.
- **The Map's code loads only when the view opens**, so Board and Table don't get
  heavier. Target 60 KB gzipped for the Map's chunk, layout code included; the same
  JavaScript ships to phones ([tech-stack.md](../tech-stack.md)). From a real `vite build`, the
  Map's chunk is 145.7 KB, 53.4 KB gzipped, with 3.2 KB of CSS, and the layout worker is another
  44.4 KB, 17.5 KB gzipped (d3-force, the layout, and the outline tracing), so the whole is about
  74 KB. With d3-zoom it was 191.6 KB, 68.9 KB gzipped: d3-zoom and the packages it pulls in
  (selection, transition, interpolate, color, timer, dispatch, drag) were 46 KB of the chunk
  before gzip, about 15 KB after, so the camera is the Map's own (see the feasibility notes).
- A project past the read cap (5,000 rows, the list cap) still opens. Finished
  families (a parent and every descendant done) fold into their parent's row,
  oldest first, until the read fits: the row carries `summarizedDescendants`, the
  family's newest anchor, and the family's blocker links, and links elsewhere that
  named a folded item name the row. The response's `summarized` flag says so, and
  the Map says that it's summarizing. Unfinished work never folds, so a project
  whose open work alone passes the cap comes back whole. A generated project of 5,460
  items (120 finished epics of 30, 40 open ones of 20, 900 loose) opens with 4,980 rows,
  the notice "This project is past the read cap, so finished families are summarized", the
  summary strip counting all 5,460, and a 64 KB read.
- **The read** at about 100 KB gzipped for 2,000 items: 38 KB for a generated 2,000-item board
  (259 KB before gzip), 18 KB at 1,000, and 64 KB for the capped 4,980 rows of the project above.
  On Postgres 16 with four other 5,000-item projects in the same tables: about 28 ms in
  the database and 56 ms end to end for 2,000 items, and 64 ms and 115 ms for 5,000.

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

- Keyboard-complete (see [Navigation](#navigation-and-interaction) and [Keys](#keys)).
- A parallel accessible tree in the DOM mirrors the Map: families and standalone
  items, newest anchor first, using the `tree`, `treeitem`, and `group` roles with
  `aria-level`, `aria-setsize`, `aria-posinset`, and `aria-expanded`, and status in
  each item's name. The Table view stays the visible linear alternative.
  - The tree is the focus target itself, not a hidden mirror: it is the one tab stop,
    and it holds DOM focus while `aria-activedescendant` follows the Map's own focus, so
    a screen reader says the item the keys land on and focus never leaves the Map. A
    mirror that didn't hold focus would need its own keys and a second focus to keep in
    step with the first. It is clipped to nothing, not `display: none`, so it stays in
    the accessibility tree; the canvas is `aria-hidden`, since the tree says everything it
    draws.
  - A region is an open item holding a group of its children; a folded family is a
    closed item with its children out of the tree; a leaf has no `aria-expanded`. An
    item's name is its key and title, its status, its sub-status, what it waits on, why
    it needs a person, its up-next number, a live session, and for a family how many
    items it holds. Computers and their sessions are a group of their own after the items,
    since `L` lands on a session.
  - A screen reader's activate on an item does what Enter does on the focused one. The
    Map's edge markers are not tab stops (`P` and `L` reach what they point at, and the
    tree lists the rest).
- Color is never the only carrier of meaning. Text meets WCAG AA contrast and
  glyphs meet 3:1, in both themes.
- `prefers-reduced-motion` stops presence motion and turns camera flights,
  transitions, and time drift into cuts. That covers every flight (Fit all, Now, a jump
  to an item, the keys' pans, the minimap's, the stepping bar's), the zoom step, the
  level fades, the hover and focus fade, a dragged dot's return, the card and quick card
  fades, a refresh's staged exits, glides, and entries (with the time drift inside them),
  the status sweep, the ping ring, a new item's grow-in, a region outline's crossfade, and
  the hover colors of the page's own controls. What changed carries the board's highlight
  instead, in the accent color (the palette's link color under forced colors).
- Remote changes are announced through a polite live region, rate-limited, with a
  setting to turn the announcements off. A change is an item filed or gone, a new status,
  a question to answer, a PR opened, or an agent arriving. The first one after a quiet
  stretch is said at once and the rest wait out a five second gap and go out together
  (three named, then a count); announcing is off or on per device, on by default, from
  "Announce changes" at the right of the summary strip. Off drops remote changes, but not
  the live region's answers to the person's own keys.
- Under `forced-colors: active` the canvas draws with the person's system colors, which it
  asks the browser for (`Canvas`, `CanvasText`, `GrayText`, `LinkText`, `VisitedText`)
  rather than the design tokens, since a canvas never receives the forced palette: every
  glyph is the text color (status is told by shape), regions are untinted and outlined in
  it, chain links and the ring that marks needs a person keep their lines, and the
  rollup bar gives each phase its own system color. A system color that doesn't clear
  3:1 against the person's canvas gives way to the text color.

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
- As built (SPE-229), the region distances (the 32 pad, 12 per nesting level for
  up to four levels, so a deep hierarchy can't grow a grid without bound, the 20
  disk) are layout units, the units the layout spaces families in, so a region
  scales with its dots; only the grid follows the zoom: 5 units below 1.4x, 2.5
  above, never coarser, since a coarser grid can't resolve a long-running epic's
  neck and the epic breaks into islands. The disk filter was nine tenths of the
  cost, so the closing runs on a 10-unit grid and is read back bilinearly, the
  fine field's own detail kept where it's larger. A nested region keeps only
  ground where its parent's field clears the level by 0.06, which is what
  guarantees it sits inside. Of the loops one region traces, the one holding the
  most members stands. Outlines are computed once per layout and grid step, never
  during a pan: the worker traces them with each layout, at the 5-unit step the
  Map's extent is measured at and at whatever step the Map is drawing (SPE-235), so
  a new layout costs the main thread nothing; a zoom into a step the layout didn't
  bring draws the nearest cached outlines (they're in layout units, so they still
  fit) while the worker traces the new step and hands it back as transferred buffers, and
  the Map draws it when it arrives (SPE-238: tracing a big board's finer step on the main
  thread took 0.2 to 0.7 s and froze the zoom). On a
  generated 1,000-item board (682 nodes,
  17 regions with finished epics folded) a step costs about 21 ms at 5 units and
  56 ms at 2.5; with every family open (34 regions, 610 members), 35 ms and
  104 ms. The spanning tree is Kruskal over a grid's neighboring pairs rather than
  exact Prim, within a few percent of the minimum, so one huge epic stays cheap: a
  single 5,000-member family outlines in about 110 ms at 5 units.
- Where the layout lets two families interleave, a member can sit on ground its
  neighbor's field wins, and the drawing can't fix that without overlapping: on
  that generated board, whose open epics have children spread over 120 days,
  about a quarter of region members land outside their own outline. The
  realistic 200-item board loses none. Keeping families apart is the layout's
  job.
- Alternatives if `d3-force` falls short: ForceAtlas2 through graphology (Gephi's
  organic layout, about 3 KB plus graphology), or WebCoLa (about 21 KB), whose
  separation constraints are the ordering rule built in.
- Rendering cost is per item, not per API. In a 2018 benchmark of trees drawn at
  about 15 primitives per node, SVG and Canvas both dropped frames above roughly
  400 nodes, and WebGL held up only once text was removed
  ([Horak et al.](https://mt.inf.tu-dresden.de/cnt/uploads/Horak-2018-Graph-Performance-Poster.pdf)).
  So one Canvas 2D layer draws dots and links at far and middle zoom, and Preact
  components draw cards at near zoom, culled to the viewport (real text, real
  focus, and `@specboard/ui` reuse). The camera is hand-rolled, 3.2 KB minified and 1.6 KB gzipped: pointer
  events with pointer capture for drag and pinch, one non-passive wheel listener that
  normalizes `deltaMode`, and a requestAnimationFrame flight along van Wijk and Nuij's smooth
  zoom path, eased by a cubic-bezier solver. `d3-zoom` ran it first, and was about 15 KB
  gzipped once `d3-transition` came along: it patches `d3-selection`'s prototype on import, so
  nothing could shake it out, and that alone put the Map's chunk over its 60 KB budget.
- As built (SPE-230), the cards sit in one translated element, so a pan is one style
  write and the cards re-render only when the set in view changes. Cards and labels
  are placed every frame against a grid of taken boxes. On a generated 2,000-item
  board panning at 1x pixel ratio held 60 fps (median frame 16.7 ms, 95th percentile
  18 ms) at the near level with 1 to 14 cards and a compact label on most of the
  rest (the Map's paint 1.5 to 2 ms on average), and at the middle level with a label
  on every dot with room (2.5 ms), with occasional stalls, the worst 84 ms at near
  and 150 ms at middle, a few frames in each 400-frame run. A board that dense has
  few cards, since none may overlap; before cards were placed apart, 34 to 58 of them
  panned at 60 fps with the same 18 ms 95th percentile. At 2x pixel ratio the same
  pan runs at 30 fps with or without cards, since the 2,560 px canvas fill is what a
  software rasterizer can't keep up with.
- As built (SPE-232), time passes between reads, so what is live, quiet, or gone is
  decided against the clock and not by the layout: the layout puts every session that
  wrote in the last hour into a cluster, and the page asks the clock again every minute
  (and on every read), redrawing only if a session crossed 15 minutes or an hour, or an
  in-progress item's sessions all went quiet. It never lays out again for that. A session
  that has left the cluster leaves the drawing at once, with its lines and its computer's
  block, and its items stay where they sit until the next read places them back with their
  families and their moments. "How long it has been on the item" is the episode's own start,
  which `item_workers` already stores and the read now carries. The still glow is a radial
  gradient on the canvas behind a live session's dot and behind the item it is on (and on a
  near-level card's glyph), with no animation; a quiet session is a hollow dot with a dashed,
  muted line, so quiet never rests on hue alone. A computer's text block is placed by the
  label pass before the in-progress labels, and the items it names lose their own label only
  when it found room. Clicking a computer or session holds it lit with its card open and
  opens no drawer. Zoomed in, each session's line in the block also names its agent.
- As built (SPE-235), a refresh is a delta read (`GET .../map?since=<cursor>`) and a
  staged transition. The cursor is the database's clock taken in a statement before the
  read's snapshot, a second back, and no later than the oldest open client transaction in
  `pg_stat_activity`; `updated_at`, `last_seen_at`, and `ended_at` are `NOW()`, the start
  of the transaction that wrote them, so a write the snapshot missed carries a stamp at or
  past the cursor however late it commits. Checked on Postgres 16: a write held open 3 s
  across a read came back in the next delta, where a cursor of "read time less a second"
  would have missed it. Rows the overlap repeats merge by key and diff as no change. The
  delta carries each changed item's row whole (anchor, links, open episodes), and an item
  whose agent wrote or stopped since rides along though its `updated_at` didn't move; the
  client has the whole tree, so a parent's subtree anchor follows its child. Deletions and
  spec links come from two signals in the read's own snapshot, the project's item count
  and its spec links' count and newest time: rows merged from a delta that don't come to
  the count, or a changed spec signal, read the whole project at once, so both show within
  one poll. Past the read cap an idle delta stays empty and any change answers whole. On a
  generated 2,000-item project an idle poll is 416 bytes and one with five changed items
  1.5 KB (736 bytes gzipped). The changes since the last visit refresh on the same poll,
  keeping the changes view open on its step; a baseline marked seen locally isn't undone by
  a read that beats its write to the server.
- A refresh buffers in the model and applies at most once a second as a local pass; a
  collapse toggle doesn't wait, and cuts. Time drift moves the scale's edge to the new now
  and carries every previous position onto the moved scale by the moment it stands for
  (`shiftX`), so the pinned Map slides as one and no two dots swap sides; the equalized
  scale keeps the anchors it was fitted to, since counting a changed item's new anchor
  would move every dot after its old one. An idle poll lays out again for drift alone only
  once recent work would slide a layout unit. The pass's extent only grows. On the
  generated 1,000-item board three pickups moved 179 of 682 nodes more than half a unit
  and left 628 within 4 (944 of 1,007 with every family open); the local pass took 95 to
  140 ms in Node, and from the read landing to the glide starting took about 1.1 s in
  Chrome's worker with outlines at both steps.
- The surface glides from where it draws everything now (a transition interrupted halfway
  included) to the new layout: exits fade and shrink (into the ancestor's dot when a
  finished family folds) over 250 ms, then moves glide over 700 ms with status sweeps
  (250 ms, the new glyph revealed clockwise from twelve) and one amber ring per observed
  write (900 ms) starting with them, then entries grow out of their region's center, or
  fade in where they land, over 400 ms. A stage with nothing in it is skipped. The dot
  under the pointer is held where it was and glides once the pointer leaves it; with
  nothing under the pointer, a focused or selected dot that moves takes the camera along
  by the same eased step, so it stays put on screen, until a flight or a gesture of the
  person's own takes over. Regions crossfade, old outlines out and new in, level by level:
  re-tracing the moving families every frame cost 40 to 119 ms at the 5-unit step on the
  1,000-item board (12 to 29 families moved), against a frame's 16. Under reduced motion
  every stage cuts and the changed items carry the board's highlight, a halo of
  `--color-primary` at 30%, for 2 s. Measured in Chrome at 1x on the 1,000-item board:
  frames during a glide had a median of 16.7 ms and a 95th percentile of 18.4 ms, with one
  frame of 50 ms where the new layout landed; a refresh landing mid-pan left the pan's
  frames as they were (median 16.9 ms, worst 35 ms, the same as the 3 s before it) with no
  long task.
- As built (SPE-238), the last pass, on this board's own structure and a second, 272-item board's
  (both in the layout tests, anonymized), a generated 1,000-item board, a 5,460-item one, and
  boards of ten unrelated items and of one 400-child epic:
  - A loose dot tied by discovered-from to a family member could land inside that family's region
    (one case on the 272-item board at some canvas aspects; 21 on the generated 1,000-item board
    and 142 on a 3,000-item one, before). The band force that stacks sibling regions now also
    pushes a loose dot out of any top-level region's band whose stretch of time it is in (20 units
    past the region's dots; 30 pressed members out of their outlines on a 3,000-item board where
    two regions leave little room between them); none sit in a region now on either real
    board at any canvas aspect or on a generated 1,000-item board (21 before), and 7 on a
    2,000-item board (69) and 8 on a 3,000-item one (142), with every member inside its outline. The anonymized fixtures don't reproduce the 272-item
    case (the layout hashes keys into its starting heights, and the staged keys are gone), so
    the regression test is the generated board.
  - The strip past now is held only while a computer is working; a board with none ends 0.08 of a
    unit past now. Ten unrelated items: 230 of 647 units of empty ground past the last dot, now 80
    of 595.
  - A chain is pulled to its common height with strength 3, where each item was pulled level with
    its blocker with strength 0.6 and a chain sloped 12 to 29 units a step in a crowd. Now
    0.7 to 3 on average (a finished chain, whose dots close days apart and sit a few units
    apart in x, can't be level and apart: it keeps the little slope that separates them).
  - A session's pull on an item is capped (160) and all of an item's pulls on its session
    together (50), and its time target is its computer's. Before, a session working five items in
    five families dragged each toward it and the whole 1,000-item board to 23,300 by 32,800
    units; now 18,600 by 6,800 at the right aspect, the session 144 from its computer, no member
    outside its outline (165 before).
  - Outlines: the closing no longer allocates a negated copy, and the read-back skips empty cells
    (a 40-open-epic 1,000-item board: 505 ms to 316 ms at the 5-unit step, 1,143 to 820 at 2.5).
    Drawn small, an outline merges curves closer than a pixel or two (the path is rebuilt only when
    that gap doubles), within a time budget per frame when an older path exists. A 2,000-item stress
    board at fit all went from 7 fps to 36.
  - Label placement: a region's label spots are tried as boxes (the label is built where it lands),
    an outline wholly off the plot costs one point, and a level that caps region labels gives up
    after four misses per label allowed. At fit all on a 2,000-item board with 80 open regions the
    pass fell from 160 ms to 14 ms in Node. At fit all on a 1,280 by 570 plot the labels placed
    were 3 of 14 regions on this board (6 before the layout changes of this pass), 6 of 8 on the
    272-item board (5), 3 of 17 on a generated 1,000-item board (7) and 8 at 1,600 by 800 on
    all of them: the cap of 8 is reached when the plot has room, which a loosely outlined, more
    spread layout leaves less of.
  - Long-epic boards. Both real boards read well: this board's long-running epics are bulbs on
    a thin neck, the 272-item board's two are the same, and at fit all the Map is a swim of
    them. Only the generated 40-open-epic shape stacks every family as a thin horizontal row, since
    all forty are alive at once; that reads as rows of work by family and was left as it is.
  - Region labels glide from where they stood to where the new outline puts them over the
    crossfade; the worker starts with the read, not after it; a refresh's read to its glide takes
    the worker's time (170 to 190 ms at 1,000 items in the ordinary shape, 630 ms in the
    40-epic one) plus a frame, where it took about 1.1 s.
  - The two wall-time layout assertions (1,000 items in under half a second, and with every family
    open under a second) failed whenever the suite ran beside others, in the layout tests and
    the outline ones (the default 5 s limit on tests that trace big boards). They now assert the
    simulation's bounded tick count, that 1,000 items cost under 3.5 times 500 (linear is 2, a pass
    over every pair 4, measured back to back so the load is the same on both), and a ceiling ten
    times the budget; the outline tests carry a limit that only a hang reaches. The budgets
    themselves are in Performance, measured on a quiet machine.
- Ruled out: tldraw (production use needs a license key; React-only; about
  530 KB), Excalidraw (React-only; about 350 KB), and React Flow (React-only, and a
  node editor rather than a layout engine).
- The app has no code splitting and no Web Worker yet, so the Map adds the first of
  each: a dynamic import for the view and a module worker for the layout.
  `shared/planning` has no package of its own, so `d3-force` goes in `web/package.json`,
  pinned like every dependency.

Sizes are bundlephobia's min+gzip figures as of 2026-10-02.

---

## Out of scope

- Editing items on the Map: changing status, reparenting, reordering, or creating
  items in place.
- Saving dot positions a person dragged.
- The Map below 768 px: SPE-220.
- Several projects on one Map: that's the [multi-project view](multi-project-view.md)'s
  combined Map (SPE-249), the union of each project's map.
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
