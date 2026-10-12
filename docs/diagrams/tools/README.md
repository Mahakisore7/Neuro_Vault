# Rendering the diagrams

The diagrams are Mermaid text (`../*.mmd`) rendered to themed SVGs (`../*.svg`). GitHub
renders Mermaid itself, but only in one default theme; these tools give every diagram the
same dark palette, so the README looks the same in light and dark mode.

| File | What it does |
|---|---|
| `render.mjs` | Renders each `../*.mmd` to `../*.svg` in headless Chromium: the shared theme, a rounded dark background, plain SVG text (no `foreignObject`), and colours for the class diagram |
| `art.py` | Generates the two hand-drawn graphics: `docs/images/banner.svg` and `docs/diagrams/stack.svg` |

## Re-render

Run from the repository root. `render.mjs` borrows Playwright from `frontend/`
(`pnpm install` there first) and needs Mermaid 11.4.1 installed somewhere:

```bash
mkdir -p /tmp/mm && (cd /tmp/mm && npm init -y && npm i mermaid@11.4.1)

node docs/diagrams/tools/render.mjs "$PWD" /tmp/mm            # every diagram
node docs/diagrams/tools/render.mjs "$PWD" /tmp/mm er class   # just these

python docs/diagrams/tools/art.py                              # banner and stack
```

## Adding a diagram

1. Write `name.mmd` in `docs/diagrams/`. Prefer flowcharts with `classDef` colours
   (copy the block at the bottom of `containers.mmd`) so it matches the others:
   indigo for the web app, cyan for the API, green for data, amber for external services,
   pink for people.
2. Render it, open the SVG, and check that no label is clipped.
3. Embed it with `<img src="docs/diagrams/name.svg" alt="what it shows">`. Write alt text
   that says what the diagram shows, not that it is a diagram.

The same diagrams, as editable Mermaid inside Markdown, are in
[`PROJECT-OVERVIEW.md`](../../PROJECT-OVERVIEW.md). If you change one, change both.
