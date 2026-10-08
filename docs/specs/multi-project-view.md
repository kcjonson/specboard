# Multi-project view

A read-only planning view over several projects at once. The Board, Table and Map show the items
of every chosen project mixed together, so someone working across a few boards can see all of it in
one place. Nothing in the view creates or changes anything; to act on an item you open it in its
own project.

The picker, the route, and the Table shipped first (SPE-247). The Board (SPE-248) and the Map
(SPE-249) follow, in the same container.

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
   than pushed, so Back from an item lands on the view as it was left. The route isn't
   project-scoped: it writes no `lastProjectRef` cookie and the header has no Planning/Pages tabs.
   `?view=` works the way it does on a project's planning route, with the same localStorage
   fallback and the same rule that the Map is desktop-only; until the Board and Map land, the
   view is the Table and `?view=` is carried through untouched. An address that can't be used
   (fewer than two projects or more than ten, an entry that isn't `owner/project`, a project
   listed twice) says what's wrong and links back to the projects page.
3. **Between 2 and 10 projects.** One project is just its own board. The ceiling comes from request
   volume. The view reads each project through the existing per-project endpoints at five
   requests a load (one per status window), and production's per-IP firewall rule allows 2000
   requests per 5 minutes, about 400 a minute, for the whole app. At 10 projects every load is 50
   requests: opening the view (plus one for the projects list), each poll, each search or type
   change once it settles, a show-more (on just the projects that have more), and, until
   SPE-248's drawer keeps an opened item inside the view, each Back from an item, since the item
   opens on its own page and Back loads the view again. Polling takes about 100 a minute
   (decision 4), which leaves room for five or six of the others in a minute before the limit.
   Heavy searching can still reach it: every pause long enough to settle the search is another
   50. The picker refuses an eleventh project and says why.
4. **It polls every 30 seconds, not 10.** Same focus rule and back-off as the board, and the same
   hold while the view is in error. A refocus polls at once only if the 30 seconds have run out
   since the last poll, so switching windows adds no polls (the board keeps the same rule at 10
   seconds). At 10 projects a poll is 50 requests, about 100 a minute. An overview can be 30
   seconds stale.
5. **Two projects with the same key prefix can't be viewed together.** Item keys are unique per
   owner only (`idx_projects_owner_key`), so a project shared from someone else can carry the same
   prefix as one of yours. Selection, highlighting, keyboard navigation, the Map's rows and its
   relations all key on the item key, so the picker refuses the second project of a prefix and
   says why ("SPE is already used by Specboard; pick one of them"). A hand-edited URL can still
   pair them; the view then drops the later one, with a notice naming both. Within a valid
   selection every key is unique, and the key's prefix tells you which project an item is from.
6. **Read-only.** No "+ New", no drag-and-drop, no `n` or `1/2/3` keys. The Map was already
   read-only except for one write, the since-last-visit baseline (`POST /map/seen`), and the
   combined Map doesn't make it (see 10).
7. **Opening an item takes you to it in its own project:** the standalone item page,
   `/projects/:owner/:project/items/:key`, where your role in that project decides what you can
   change. It's a pushed history entry, so Back returns to the combined view as you left it. A
   child row opens in its parent's project, which the Table hands over with it (a key prefix
   isn't trusted for that: keys can be renamed while the view is open). SPE-248 replaces this
   with a read-only drawer inside the combined view: the item drawer with editing off, which
   SPE-209's read-only mode made possible.
8. **No new API.** One `ItemsCollection` per project against the existing endpoints and the existing
   authorization (SPE-206), merged on the client. The selection is checked against
   `GET /api/projects` first, and a ref that isn't there is left out with a notice naming it. A
   project the person can no longer read (a 403 or 404 on its items, say after being removed from
   it) is dropped from the view with the same notice, and the rest still render, even if only one
   is left. The notice links back to "Choose projects", and when a single readable project
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
    view separately from each project's own Map.
11. **Every card and row says which project it's from.** A project chip (the project's name, with
    `owner/project` on hover) on Board cards, and in a Project column after Title on the Table.
    Below 768 px the Table drops that column along with Type, Tasks and Assignee; the key prefix
    still names the project there. The toolbar lists the chosen projects as chips, name and key
    prefix, each linking to that project's own planning view, so the key prefixes have a legend.
12. **Search and the type filter work across all of it**, applied to each project the same way
    the single board applies them, the search debounced the same way.

## How it's built

- `shared/planning/MultiProject/MultiProjectPlanning.tsx` is the route entry. It parses
  `?projects=`, checks the selection against `GET /api/projects`, and opens one `ItemsCollection`
  per project it can show.
- `MergedItems` (`merged-items.ts`) reads across those collections behind `ItemsSource`
  (`@specboard/models`), the interface the Table reads its items through: it interleaves, adds up
  the counts, and fans out fetch, filter and show-more (a show-more widens only the projects with
  more). It also does the dropping in decision 8, and reports the dropped refs for the notice.
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
