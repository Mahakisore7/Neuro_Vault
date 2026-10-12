# NeuroVault design system

How the interface is built to look and feel consistent, and how to keep it that way when
adding a screen. The decision record is [ADR-026](adr/0026-design-tokens-and-restrained-motion.md);
the code is mostly [`frontend/src/app/globals.css`](../frontend/src/app/globals.css).

## Principles

1. **Navigation recedes; the note leads.** The sidebar is a notch dimmer than the page.
   Nothing competes for attention it hasn't earned.
2. **Structure is felt, not seen.** Separate surfaces by tone and soft elevation, not by
   an outline on everything. Fewer dividers, softer edges.
3. **One accent.** Indigo is for primary actions, focus and the current location. Colour
   that carries meaning (success, destructive, link types) is separate from the accent.
4. **Motion explains, never decorates.** Things that enter decelerate; nothing bounces.
   If an animation doesn't tell the user what changed, remove it.
5. **Every state is designed.** Loading shimmers, empty lists get an icon tile and a next
   step, errors say what to do, and nothing is ever blank.
6. **Accessible by construction.** Contrast is checked by axe in both themes on every
   pull request; motion stops for people who ask their OS for less of it.

## Colour

Defined as CSS variables in `globals.css`, in OKLCH so equal lightness looks equally
bright. Components use the tokens (`bg-card`, `text-muted-foreground`, `border-border`),
never a literal colour.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--background` | warm off-white | cool charcoal | The page |
| `--card` | white | a step above the page | Cards, popovers |
| `--sidebar` | a notch dimmer than the page | darker than the page | Navigation rail |
| `--foreground` / `--muted-foreground` | near-black / mid grey | near-white / mid grey | Text |
| `--primary` | indigo | lighter indigo | Main actions, focus, current location |
| `--accent` | pale indigo tint | dark indigo tint | Selected and highlighted surfaces |
| `--success` | green | lighter green | Saved, linked |
| `--destructive` | red (darkened to pass 4.5:1 on its own tint) | lighter red | Delete, errors |
| `--border` | very light warm grey | white at 9% | Hairlines |

Light neutrals lean warm (a "paper" feel); dark neutrals lean cool, because warm dark
greys read as muddy. Both themes are first-class: the theme switch grows out of the
toggle button as a circular reveal (View Transitions API), and snaps if the browser or
the user's motion setting says so.

## Type

| Role | Face | Notes |
|---|---|---|
| Interface | Geist Sans | Tight tracking on headings (`-0.02em` to `-0.04em`), `text-wrap: balance` |
| Code and keys | Geist Mono | Keyboard hints, SQL snippets |
| Writing (optional) | Newsreader (serif) | Chosen per person in a note's **Text style** menu; remembered in the browser |

Body copy is 13–14 px in dense UI (sidebar, lists) and 16–17 px in the editor. Numbers
that line up use `tabular-nums`.

## Elevation

| Utility | Use |
|---|---|
| `shadow-soft` | Resting cards and buttons |
| `shadow-raised` | Menus, popovers, a card on hover |
| `shadow-floating` | Toasts, the hero window on the landing page |

## Shared utilities

Add one class instead of writing per-page CSS.

| Class | Effect |
|---|---|
| `card-interactive` | A card that is a link or button: 2 px lift, brighter border, firm press, focus ring |
| `stagger` | Children rise in one after another (40 ms apart, first twelve) |
| `empty-state` + `empty-icon` | An empty list: tinted icon tile, faint wash, centred copy |
| `skeleton-shimmer` | Loading placeholder with a light sweep (the `Skeleton` component uses it) |
| `animate-rise`, `animate-fade` | One-off entrances for server-rendered content |

## Motion

One easing curve and three durations, so motion feels like one hand made it.

| Kind | Duration | Easing | Examples |
|---|---|---|---|
| Feedback | 100–150 ms | ease-standard | Hover colour, press, focus ring |
| State change | 250–300 ms | ease-out expo | Page enters, cards lift, sidebar collapses |
| Layout and showpiece | 350–550 ms | ease-out expo / spring | The sidebar's active pill sliding, graph links drawing, landing reveals |

Building blocks live in [`components/motion.tsx`](../frontend/src/components/motion.tsx):
`Reveal`, `Stagger` / `StaggerItem`, `CountUp`, and the shared `EASE_OUT` and `SPRING`.

**Reduced motion.** A global `prefers-reduced-motion` rule shortens every CSS animation to
nothing, `MotionConfig reducedMotion="user"` covers the `motion` components, and each
component renders its final state outright instead of fading in. The browser tests run in
this mode.

## Layout and navigation

- **App shell:** a 48 px blurred header (search, notifications, theme) over a 240 px
  sidebar. The sidebar collapses to a 56 px icon rail with `Ctrl \`, remembers the choice,
  and becomes a slide-in drawer on small screens.
- **Sidebar contents:** New note, the four navigation groups, then **Pinned** and
  **Recent** notes so the notes you reach for are one click away from any page. A sliding
  pill marks the current location.
- **Command palette (`Ctrl K`):** opens on your recent notes, then commands; typing
  searches notes and filters commands.
- **Pages:** a single column of 672–1152 px by content type, 32 px from the top, content
  rising in on entry. Page titles are 22 px; the home greeting is larger.

## Adding a screen

1. Use tokens; if a colour isn't one, it doesn't belong in a component.
2. Use `Card`, `Button`, `Dialog` and friends from `components/ui`.
3. Lists of cards: add `stagger` to the grid and `card-interactive` to each card.
4. Empty list: a block with `empty-state`, an icon with `empty-icon`, a title, a sentence,
   and a button for the next step.
5. Loading: `Skeleton`s shaped like the content. Never a blank page, never a spinner alone.
6. Anything that animates on its own: check it under reduced motion.
7. Run the axe scan (`pnpm test:e2e`) in both themes. It will find contrast mistakes
   before a reviewer does.

## What drove these choices

- Linear's design write-ups
  ([a design reset](https://linear.app/now/a-design-reset),
  [how we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui),
  [behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)):
  dimmer navigation, "structure should be felt not seen", warmer less-saturated greys,
  fewer separators, aligned headers.
- The general pattern across note-taking apps such as Craft and Bear: restraint,
  typography and speed read as premium; feature count does not.
- Common motion guidance: roughly 100–150 ms for feedback, 200–300 ms for state
  changes, ease-out for entering and ease-in for leaving, no bounce in work software,
  and always respect reduced motion.
