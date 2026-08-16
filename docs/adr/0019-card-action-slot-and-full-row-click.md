# ADR-019 — List-item cards use the `CardAction` slot and a full-row click handler

**Problem.** Two symptoms reported against the deployed workspace list: the
three-dot menu rendered *below* the workspace name instead of top-right next
to it, and clicking anywhere on a card except the title text did nothing —
no navigation into the workspace.

**Root cause — two independent defects, not one.**

1. **The menu position.** shadcn's `CardHeader` (`frontend/src/components/ui/card.tsx`)
   is `display: grid` by default, and only gains a second column
   (`grid-cols-[1fr_auto]`, title left / action right) when a child carries
   `data-slot="card-action"` — shadcn's own `CardAction` wrapper sets that
   attribute. The affected pages instead passed the dropdown menu in as a
   bare sibling of `CardTitle` and tried to lay it out with a className
   override of `flex-row items-start justify-between`. That override never
   took effect: `flex-row` sets `flex-direction`, not `display`, so it
   doesn't conflict with (and can't remove) the base `grid` class in
   Tailwind's merge logic. `display` silently stayed `grid`, no second
   column was ever defined, and with `grid-auto-flow`'s default of one
   implicit column, the title and the menu simply stacked into two rows.
2. **The dead click zone.** Only the workspace name itself was wrapped in a
   `<Link>`. The rest of the card — its padding, its description text, the
   empty space around the icon — had no click handler at all, so it looked
   interactive (`hover:shadow-md`) without being interactive almost
   everywhere on its surface.

**Alternatives considered (for the menu position).**

- Fix the className override itself — change `flex-row` to `flex`, which
  *would* correctly override `grid` in Tailwind's merge (they're both
  `display` values, so they're recognized as conflicting). Rejected: doing
  this per-page keeps every card responsible for reimplementing layout that
  `CardHeader` already has a purpose-built mechanism for, and it would
  silently stop composing with `CardDescription`'s own grid-row behavior
  (`has-data-[slot=card-description]:grid-rows-[auto_auto]`), which several
  cards also rely on.
- Wrap the trailing action in shadcn's own `CardAction`. **Chosen.** It's
  exactly the mechanism `CardHeader` already ships for this: no fighting the
  base layout, and it keeps working if a card later adds a description too.

**Chosen pattern, applied everywhere a list uses a card with a trailing
action** (workspaces, notebooks, the notebook's note list, unfiled notes):

- The menu trigger is wrapped in `<CardAction>`, not a bare sibling.
- The `Card` itself carries `role="button"`, `tabIndex={0}`, `onClick`, and
  an `onKeyDown` handling Enter/Space, navigating to the item's detail page.
- The menu's trigger `Button` and `DropdownMenuContent` both call
  `e.stopPropagation()`, so opening the menu or clicking Delete/Archive
  doesn't also fire the card's own navigation.

**Trade-off.** Every card with a trailing action now needs three things
instead of one: the `CardAction` import, the `role`/`onClick`/`onKeyDown`
trio on `Card`, and `stopPropagation()` on the action. None of this is
enforced by a shared component — a new card built without copying the
pattern will reproduce either defect. Worth revisiting as a shared
`ListItemCard` component if a fifth instance of this pattern shows up.

**Learning note.** Two lessons, not one:

- *The bug itself* is structurally invisible to `tsc`, `eslint`, and
  `next build` — Tailwind's class strings are just data to all three tools;
  the conflict only exists at the CSS cascade level, observable only by
  looking at the rendered page. Same shape of bug as
  [ADR-016](0016-uniqueconstraint-naming.md).
- *Fixing a bug on a branch does not fix the bug* until that branch is
  merged. This exact fix was built and committed once already, but sat on
  an unmerged branch — so it was rediscovered independently, as a fresh bug
  report against `main`, before anyone had merged the branch that already
  fixed it. See the session log's branch-consolidation section for the full
  story of how that happened.
