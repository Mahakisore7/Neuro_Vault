# ADR-026: Design tokens and restrained motion

**Context.** The first interface worked but looked like a course project: a dark navy
sidebar competing with the content, every card boxed in the same outline, state changes
that snapped, and no shared rule for spacing or colour. Making it feel like a product
meant changing many screens at once. The risk of doing that screen by screen is drift:
twelve pages that each look slightly different.

**Options.**
1. Restyle each page by hand. Fast for one page; it drifts by the third.
2. Adopt a component library with its own look. Consistent, but it replaces what we
   already have (shadcn/ui on Tailwind v4) and the result looks like the library.
3. Keep shadcn/ui, and move every visual decision into **tokens and a few shared
   utilities** in `globals.css`, so a page gets the new look by using the system.

**Chosen: 3.** The decisions come mainly from Linear's published redesign write-ups
(the most concrete source found), plus the common observation that Craft and Bear feel
premium through restraint, typography and speed rather than feature count:
- **Navigation recedes, content leads.** The sidebar is a notch dimmer than the page.
  Linear: "don't compete for attention you haven't earned".
- **Structure felt, not seen.** Surfaces separate by tone and soft elevation
  (`shadow-soft`, `shadow-raised`, `shadow-floating`) instead of outlines on everything.
- **Warm neutrals in light, cool in dark.** Light mode is a warm "paper"; dark mode
  moved to cool neutrals after the warm version read as muddy. One indigo accent carries
  primary actions, focus and the current location.
- **Motion is a system, not decoration.** One easing curve (ease-out expo), durations of
  about 150 ms for feedback, 250 ms for state changes, 350 ms for layout moves. Entering
  things decelerate; nothing bounces.
- **Utilities, not per-page CSS:** `card-interactive`, `stagger`, `empty-state`,
  `skeleton-shimmer`. A list opts in with one class.
- **Reduced motion is honoured twice:** a global `prefers-reduced-motion` rule for CSS,
  and `MotionConfig reducedMotion="user"` plus explicit `initial={false}` for the
  `motion` components, so content is never left mid-fade.

**Consequences.**
- Every screen changed together, and a future page gets the look by using the utilities.
- Motion adds one dependency, `motion`. Its bundle cost wasn't measured; if the
  landing page weight matters, check it before adding more animation.
- The browser tests run with `reducedMotion: "reduce"`. That keeps them deterministic and
  stops axe from measuring contrast on a half-faded element; it also means they exercise
  the reduced-motion path, not the animated one.
- Server-rendered content (the sign-in layout) animates with a CSS keyframe, not a
  `motion` component. A JavaScript `initial={{ opacity: 0 }}` rendered on the server can
  hydrate differently for a reduced-motion visitor and be left invisible.
- The new palette broke two contrast checks that axe caught (small uppercase sidebar
  labels, and red text on a pale red tint). Both were fixed in the tokens, not in the
  components that exposed them.

**Learning note.** Polish is mostly consistency. A handful of tokens and four utilities
did more for the interface than any single screen redesign, and the accessibility scan
turned a subjective "does this look right" into a check that fails the build.
