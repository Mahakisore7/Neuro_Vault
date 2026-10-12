import math

FONT = "Segoe UI, -apple-system, Helvetica, Arial, sans-serif"

# ---------------- banner ----------------
W, H = 1280, 420
nodes = [(930, 95, 7), (1010, 200, 10), (880, 230, 6), (1110, 120, 6), (1150, 260, 8), (980, 330, 6),
         (820, 120, 5), (1210, 170, 4), (1060, 50, 4), (900, 350, 4), (1190, 350, 5), (780, 260, 4)]
edges = [(0, 1), (1, 2), (1, 3), (1, 4), (2, 5), (4, 5), (0, 6), (3, 7), (0, 8), (5, 9), (4, 10), (2, 11), (6, 2), (3, 8)]
s = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="NeuroVault: a knowledge base where notes form a graph">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="0.55" stop-color="#121646"/><stop offset="1" stop-color="#1E1B6B"/></linearGradient>
<radialGradient id="glow" cx="0.78" cy="0.45" r="0.55"><stop offset="0" stop-color="#6366F1" stop-opacity="0.45"/><stop offset="1" stop-color="#6366F1" stop-opacity="0"/></radialGradient>
<radialGradient id="glow2" cx="0.1" cy="1.05" r="0.5"><stop offset="0" stop-color="#06B6D4" stop-opacity="0.22"/><stop offset="1" stop-color="#06B6D4" stop-opacity="0"/></radialGradient>
<linearGradient id="word" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C7D2FE"/></linearGradient>
<linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818CF8"/><stop offset="1" stop-color="#4338CA"/></linearGradient>
<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#A5B4FC" stop-opacity="0.75"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0.55"/></linearGradient>
<filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1" fill="#A5B4FC" fill-opacity="0.13"/></pattern>
<clipPath id="r"><rect width="{W}" height="{H}" rx="22"/></clipPath>
</defs>
<g clip-path="url(#r)">
<rect width="{W}" height="{H}" fill="url(#bg)"/>
<rect width="{W}" height="{H}" fill="url(#dots)"/>
<rect width="{W}" height="{H}" fill="url(#glow)"/>
<rect width="{W}" height="{H}" fill="url(#glow2)"/>
"""
for a, b in edges:
    x1, y1, _ = nodes[a]
    x2, y2, _ = nodes[b]
    s += f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="url(#edge)" stroke-width="1.6"/>\n'
for i, (x, y, r) in enumerate(nodes):
    hub = i == 1
    col = "#22D3EE" if i in (5, 9, 10) else ("#F472B6" if i in (7, 8) else "#A5B4FC")
    s += f'<circle cx="{x}" cy="{y}" r="{r * 2.4}" fill="{col}" opacity="0.28" filter="url(#blur)"/>\n'
    s += f'<circle cx="{x}" cy="{y}" r="{r}" fill="{"#fff" if hub else col}" stroke="#0B1020" stroke-width="2"/>\n'
    if hub:
        s += f'<circle cx="{x}" cy="{y}" r="{r + 9}" fill="none" stroke="#818CF8" stroke-opacity="0.55" stroke-width="1.5"/>\n'
s += """<g transform="translate(76,96)">
<rect width="64" height="64" rx="16" fill="url(#logo)"/>
<rect width="64" height="64" rx="16" fill="none" stroke="#fff" stroke-opacity="0.22"/>
<g stroke="#fff" stroke-width="3.2" stroke-linecap="round" fill="none"><line x1="32" y1="44" x2="32" y2="30"/><line x1="32" y1="30" x2="19" y2="19"/><line x1="32" y1="30" x2="45" y2="19"/></g>
<circle cx="19" cy="19" r="5.5" fill="#fff"/><circle cx="45" cy="19" r="5.5" fill="#fff"/><circle cx="32" cy="46" r="5.5" fill="#fff"/>
</g>
"""
s += f"""<text x="160" y="145" font-family="{FONT}" font-size="22" font-weight="600" letter-spacing="6" fill="#A5B4FC">NEUROVAULT</text>
<text x="74" y="238" font-family="{FONT}" font-size="66" font-weight="800" letter-spacing="-2.2" fill="url(#word)">Notes that form</text>
<text x="74" y="310" font-family="{FONT}" font-size="66" font-weight="800" letter-spacing="-2.2" fill="url(#word)">a graph<tspan fill="#818CF8">.</tspan></text>
<text x="76" y="352" font-family="{FONT}" font-size="21" fill="#A8B3D6">PostgreSQL does the heavy lifting: typed links, versions, search and shortest paths.</text>
"""
chips = [("PostgreSQL", "#34D399"), ("FastAPI", "#22D3EE"), ("Next.js 16", "#A5B4FC"), ("Supabase", "#FBBF24")]
x = 76
for t, c in chips:
    w = len(t) * 8.6 + 40
    s += (f'<g transform="translate({x:.0f},378)"><rect width="{w:.0f}" height="26" rx="13" fill="{c}" fill-opacity="0.12" '
          f'stroke="{c}" stroke-opacity="0.55"/><circle cx="14" cy="13" r="3.4" fill="{c}"/>'
          f'<text x="26" y="18" font-family="{FONT}" font-size="13" font-weight="600" fill="{c}">{t}</text></g>\n')
    x += w + 10
s += "</g></svg>\n"
open("docs/images/banner.svg", "w", encoding="utf-8").write(s)

# ---------------- stack ----------------
rows = [
    ("Experience", "Frontend", "#818CF8", "#1B1A55",
     ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4", "shadcn/ui", "Tiptap 3", "TanStack Query", "motion"]),
    ("Application", "Backend", "#22D3EE", "#0B3340",
     ["FastAPI", "Pydantic v2", "SQLAlchemy 2 (async)", "asyncpg", "Alembic", "uv"]),
    ("Data", "Database", "#34D399", "#0B3328",
     ["PostgreSQL 15+", "Triggers", "Views", "PL/pgSQL", "GIN search", "Composite FKs", "Row level security"]),
    ("Identity", "Auth", "#F472B6", "#3A1530",
     ["Supabase Auth", "Email + Google + GitHub", "ES256 JWTs", "JWKS verification"]),
    ("Confidence", "Quality", "#FBBF24", "#3A2A0A",
     ["pytest: 176 tests", "Playwright + axe: 33 tests", "ruff", "pyright", "ESLint", "GitHub Actions"]),
    ("Delivery", "Hosting", "#A78BFA", "#271C4D",
     ["Vercel (web app)", "Render + Docker (API)", "Supabase (database, auth, storage)"]),
]
W = 1280
pad, lw, rh, gap, top = 28, 190, 74, 12, 70
H = top + len(rows) * (rh + gap) + pad - gap + 10
s = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="NeuroVault technology stack by layer">
<defs><linearGradient id="bgs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="1" stop-color="#101542"/></linearGradient></defs>
<rect width="{W}" height="{H}" rx="20" fill="url(#bgs)"/>
<text x="{pad + 4}" y="44" font-family="{FONT}" font-size="22" font-weight="700" fill="#E0E7FF">Technology stack</text>
<text x="{W - pad - 4}" y="44" text-anchor="end" font-family="{FONT}" font-size="14" fill="#8B9BC4">six layers, each choice recorded in an ADR</text>
"""
for i, (layer, name, c, bg, items) in enumerate(rows):
    y = top + i * (rh + gap)
    s += f'<rect x="{pad}" y="{y}" width="{W - 2 * pad}" height="{rh}" rx="14" fill="{bg}" stroke="{c}" stroke-opacity="0.35"/>\n'
    s += (f'<rect x="{pad}" y="{y}" width="{lw}" height="{rh}" rx="14" fill="{c}" fill-opacity="0.16"/>'
          f'<rect x="{pad + lw - 14}" y="{y}" width="14" height="{rh}" fill="{bg}"/>\n')
    s += f'<text x="{pad + 22}" y="{y + 32}" font-family="{FONT}" font-size="12" font-weight="700" letter-spacing="2" fill="{c}">{layer.upper()}</text>\n'
    s += f'<text x="{pad + 22}" y="{y + 55}" font-family="{FONT}" font-size="22" font-weight="700" fill="#FFFFFF">{name}</text>\n'
    x = pad + lw + 22
    for t in items:
        w = len(t) * 8.4 + 30
        s += (f'<g transform="translate({x:.0f},{y + rh / 2 - 17})"><rect width="{w:.0f}" height="34" rx="17" fill="{c}" fill-opacity="0.13" '
              f'stroke="{c}" stroke-opacity="0.6"/><text x="{w / 2:.0f}" y="22" text-anchor="middle" font-family="{FONT}" '
              f'font-size="14" font-weight="600" fill="#F1F5F9">{t.replace("&", "&amp;")}</text></g>\n')
        x += w + 10
s += "</svg>\n"
open("docs/diagrams/stack.svg", "w", encoding="utf-8").write(s)
print("ok")
