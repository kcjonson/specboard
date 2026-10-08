# Multi-project view

A read-only planning view over several projects at once. The Board, Table and Map show the items
of every chosen project mixed together, so someone working across a few boards can see all of it in
one place. Nothing in the view creates or changes anything; to act on an item you open it in its
own project.

Built in three pieces: the picker, the route, and the Table (SPE-247); the Map over several
projects (SPE-249); and the Board, the view toggle, the Map mounted in the view, and the
read-only item drawer (SPE-248).

Related: [kanban-ui.md](kanban-ui.md) (the single-project Board and Table),
[ai-development-overview.md](ai-development-overview.md) (the Map),
[multi-user-collaboration.md](multi-user-collaboration.md) (roles, and SPE-209's read-only mode).

## Decisions

1. **Entry is a button on the projects page.** "View together" sits beside "+ New Project",
   once there are at least two projects to pick from. It turns the project grid into a picker:
   every card gets a checkbox and shows its key prefix, clicking a card (or Space or Enter on it)
   toggles it instead of opening the project, and a bar above the grid reads "Choose projects to
   view together", the count, Cancel, and "View N projects". The bar stays pinned as the grid
   scrolls. Escape or Cancel leaves the picker. The picker starts with the last selection the
   person opened from it (localStorage), so returning to the same set is two clicks; projects no
   longer listed are skipped.
2. **The route is `/planning?projects=<ref>,<ref>&view=board|table|map`.** Refs are `owner/project`,
   written unencoded (slugs never contain a comma). The URL is the whole selection, so it can be
   bookmarked or sent to someone; each viewer sees only the projects they can read. The search
   and type filter ride along as `search=` and `type=`, rewritten in place as they settle rather
   than pushed, so Back lands on the view as it was left; the open item rides as `item=` (see 7)
   and the Map's anchor as `focus=`. Every change edits the address in place, so the projects keep
   their bare commas and slashes, and a list typed by hand (`Acme/Roadmap, bob/notes`) is written
   back in its canonical form. The route isn't project-scoped: it writes no `lastProjectRef`
   cookie and the header has no Planning/Pages tabs. `?view=` works the way it does on a
   project's planning route, and through the same code: the view asked for, then the one last
   picked (localStorage, shared with every project's planning), then the Board; a pick is a new
   history entry; the Map isn't offered below 768 px, and `?view=map` opened there lands on the
   Board while keeping the request. An address that can't be used (fewer than two projects or
   more than ten, an entry that isn't `owner/project`, a project listed twice) says what's wrong
   and links back to the projects page.
3. **Between 2 and 10 projects.** One project is just its own board. The ceiling comes from request
   volume. The view reads each project through the existing per-project endpoints at five
   requests a load (one per status window), and production's per-IP firewall rule allows 2000
   requests per 5 minutes, about 400 a minute, for the whole app. At 10 projects every load is 50
   requests: opening the view (plus one for the projects list), each poll, each search or type
   change once it settles, and a show-more (on just the projects that have more). Opening an item
   loads nothing of the view: the drawer reads that one item, about five requests however many
   projects are chosen (decision 7), and only leaving for the item's own page and coming Back
   loads the view again. The Map reads each project once more, 10 requests at 10 projects, when
   it opens and at every poll, and a search settled on it asks each project once, since the lists
   aren't filtered under it. Polling takes about 100 a minute, about 120 on the Map (decision 4),
   which leaves room for five or six of the others in a minute before the limit. Heavy searching
   on the Board or Table can still reach it: every pause long enough to settle the search is
   another 50. The picker refuses an eleventh project and says why.
4. **It polls every 30 seconds, not 10.** Same focus rule and back-off as the board, and the same
   hold while the view is in error. A refocus polls at once only if the 30 seconds have run out
   since the last poll, so switching windows adds no polls (the board keeps the same rule at 10
   seconds). At 10 projects a poll is 50 requests, about 100 a minute. The lists keep polling
   under the Map, since the drawer's item lives in them, and the Map polls its own read of each
   project at the same cadence, about 120 a minute in all. An overview can be 30 seconds stale.
5. **Two projects with the same key prefix can't be viewed together.** Item keys are unique per
   owner only (`idx_projects_owner_key`), so a project shared from someone else can carry the same
   prefix as one of yours. Selection, highlighting, keyboard navigation, the Map's rows and its
   relations all key on the item key, so the picker refuses the second project of a prefix and
   says why ("SPE is already used by Specboard; pick one of them"). A hand-edited URL can still
   pair them; the view then drops the later one, with a notice naming both. Within a valid
   selection every key is unique, and the key's prefix tells you which project an item is from.
6. **Read-only.** No "+ New", no drag-and-drop, no `n` or `1/2/3` keys; the arrow keys, Enter
   and Escape still move the selection, open the item, and close it. The Map was already
   read-only except for one write, the since-last-visit baseline (`POST /map/seen`), and the
   combined Map doesn't make it (see 10).
7. **Opening an item shows it in place, read-only.** A card, a row, a child row, or a dot on the
   Map opens the item drawer with editing off, SPE-209's read-only mode, in the item's own
   project: everything the drawer reads and every link it builds goes to the project the item
   came from. A card or a row hands that project over with the item, and a child row its
   parent's, since a key prefix isn't trusted for it while the view is open (a project's key can
   be renamed under it); a Map dot's comes from its prefix, as everything on the Map does. The
   open item is in the address as `&item=<KEY>`, as a project's drawer is in its `/items/:key`,
   under the same history model (kanban-ui.md, Item URLs): opening pushes a history entry,
   moving to another item while the drawer is open replaces it, and closing (the close button,
   or Escape from the drawer, the Board, or the Table) goes back, so Back from an open item
   returns to the view as it was. Closing goes back only while the entry is still the one the
   opening pushed and nothing but the Map's anchor has changed in it: after another view is
   picked or a Map jump, Back would undo that instead, and a filter changed with the drawer
   open is the person's, so then closing leaves the view where it is. Going back returns the
   Map's camera to where it was when the drawer opened. A reload, or a link someone sent, with
   `&item=` reopens it; there the key alone names the project, by its prefix against the
   projects list just read (see 5). The drawer says it only reads here and links to the item's
   own page, `/projects/:owner/:project/items/:key`, where the person's role in that project
   decides what they can change; Enter follows that link like any other, a card selected or
   not, and Back from the page returns to the view with the drawer open.
8. **No new API.** One `ItemsCollection` per project against the existing endpoints and the existing
   authorization (SPE-206), merged on the client. The selection is checked against
   `GET /api/projects` first, and a ref that isn't there is left out with a notice naming it. A
   project the person can no longer read (a 403 or 404 on its items, say after being removed from
   it) is dropped from the view with the same notice, and the rest still render, even if only one
   is left. The Map finds the same thing on its own reads, and whichever finds it first, the
   project leaves every view at once (the lists' cards and rows, the Map's dots, the toolbar)
   and is named once. The notice links back to "Choose projects", and when a single readable project
   remains it also offers that project on its own ("Open Atlas on its own", its planning view).
   If nothing readable is left, the page says so in place of the view, with the same way back.
   Any other failure (a 500, a 429, an expired session) shows where the view goes, with Retry, as
   on one project's board. A cross-project read endpoint is the scaling path past 10 projects
   and isn't built.
9. **Mixed, not grouped.** Within each Board column and Table section, items are interleaved
   round-robin by their position in their own project: every project's first item, then every
   project's second, and so on, ties broken by selection order. Each project's own order survives,
   and every project's top work shows near the top. Ranks are per project, so sorting by raw rank
   would interleave arbitrarily.
10. **The combined Map is the union of each project's map.** Families, parents and blockers never
    cross projects, so the union is a set of disjoint families laid out together on one timeline.
    "Up next" stays per project. The combined Map shows no since-last-visit changes and never
    calls `/map/seen`: the baseline belongs to each project's own Map, and looking at the overview
    shouldn't mark a project's changes as seen. Collapse choices are remembered for the combined
    view separately from each project's own Map. A project whose Map read fails for any other
    reason stays in the view, and while the Map shows, the same notice says which: drawn as last
    loaded, or not drawn at all when it never loaded. The Map keeps asking at every poll.
11. **Every card and row says which project it's from.** A project chip (the project's name, with
    `owner/project` on hover) after the key in a Board card's footer, which wraps the update time
    to a line of its own when the chip leaves no room for it, and in a Project column after Title
    on the Table. Below 768 px the Table drops that column along with Type, Tasks and Assignee;
    the key prefix still names the project there. The toolbar lists the chosen projects as chips,
    name and key prefix, each linking to that project's own planning view, so the key prefixes
    have a legend; the view toggle sits before them, as on a project's planning view.
12. **Search and the type filter work across all of it**, applied to each project the same way
    the single board applies them, the search debounced the same way.

## How it's built

- `shared/planning/MultiProject/MultiProjectPlanning.tsx` is the route entry. It parses
  `?projects=`, checks the selection against `GET /api/projects`, and opens one `ItemsCollection`
  per project it can show.
- `MergedItems` (`merged-items.ts`) reads across those collections behind `ItemsSource`
  (`@specboard/models`), the interface the Board and Table read their items through: it
  interleaves, adds up the counts, and fans out fetch, filter, window size and show-more (a
  show-more widens only the projects with more). It also does the dropping in decision 8, and
  reports the dropped refs for the notice.
- The Board takes moves only over one project's `ItemsCollection`, since a move ranks a card among
  its own project's cards; over anything else it's read-only by type, with `canEdit={false}`.
- The Map takes `scope={{ projects }}` and reports, through `onFailures`, every project whose read
  failed and how; the container folds that into the notice. A project either side finds it
  can't read goes to the other: `MergedItems.drop`, and the Map's `unreadable` prop
  (`MapDataModel.drop`), which leaves it out as its own 403 would.
- What the view shares with a project's planning page lives in one place each: the view's state
  and its `?view=` rules (`usePlanningView`, `Planning/view.ts`), the windows each view needs
  (`usePlanningWindows`, beside it), the drawer's history model (`useDrawerHistory`) and the
  model it shows (`useDrawerItem`), the row the view and the drawer share and the width the
  drawer covers (`Workspace`), the lazily loaded Map (`LazyMap`), and the in-place address
  edits (`withQuery`, `utils/address.ts`), which the Map's `focus=` anchor uses too.
- `ItemDrawer` takes a `project` label, which turns on its read-only note and the link to the
  item's own page; it builds every link from the item's own `projectRef`.
- `ProjectChip` (`shared/planning/ProjectChip/`) is the row label; Board cards carry the same one.
  `ProjectKey` beside it is the key-prefix badge the picker cards and the toolbar chips share.
- `usePlanningFilters` (`shared/planning/Planning/filters.ts`) is the toolbar's search and type,
  for this view and a project's own planning view alike.
- `ItemsCollection` takes an `initialFilter`, so a view restored from its address requests
  filtered windows from the first request instead of loading everything and throwing it away.

## Out of scope

- Changing anything from the combined view.
- More than 10 projects, and the cross-project endpoint that would allow it.
- Two projects with the same key prefix in one view.
- Named or saved project sets beyond remembering the last selection.
- Relationships across projects (a blocker in one project on an item in another).
- The since-last-visit layer on the combined Map.
- Flashing the rows a poll changed, which a project's own board does.
