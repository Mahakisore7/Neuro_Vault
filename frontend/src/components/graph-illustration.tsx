import { cn } from "@/lib/utils";

// A static picture of what the app does: notes as chips, joined by typed,
// directed links. Decorative (aria-hidden), drawn with theme tokens so it
// holds up in light and dark.
const NODES = [
  { id: "norm", label: "Normalization", x: 210, y: 62, hub: true },
  { id: "fd", label: "Functional Dependencies", x: 90, y: 168 },
  { id: "joins", label: "SQL Joins", x: 380, y: 150 },
  { id: "btree", label: "B+ Trees", x: 240, y: 262 },
  { id: "query", label: "Query Optimization", x: 440, y: 262 },
] as const;

const EDGES: { from: string; to: string; label: string; strong?: boolean }[] = [
  { from: "fd", to: "norm", label: "prerequisite for", strong: true },
  { from: "norm", to: "joins", label: "relates to" },
  { from: "joins", to: "query", label: "supports", strong: true },
  { from: "btree", to: "query", label: "supports" },
  { from: "norm", to: "btree", label: "see also" },
];

const W = (label: string) => label.length * 6.6 + 30;

export function GraphIllustration({ className }: { className?: string }) {
  const at = (id: string) => NODES.find((n) => n.id === id)!;
  return (
    <svg
      aria-hidden
      viewBox="0 0 520 310"
      className={cn("h-auto overflow-visible", className)}
      fontFamily="var(--font-sans)"
    >
      {EDGES.map((e) => {
        const a = at(e.from);
        const b = at(e.to);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={e.from + e.to}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.strong ? "var(--primary)" : "var(--muted-foreground)"}
              strokeOpacity={e.strong ? 0.55 : 0.35}
              strokeWidth={e.strong ? 1.75 : 1.25}
              strokeDasharray={e.strong ? undefined : "4 4"}
            />
            <g transform={`translate(${mx} ${my})`}>
              <rect
                x={-(e.label.length * 2.9 + 8)}
                y={-9}
                width={e.label.length * 5.8 + 16}
                height={18}
                rx={9}
                fill="var(--background)"
                stroke="var(--border)"
              />
              <text
                textAnchor="middle"
                dy="3.5"
                fontSize="9.5"
                fill="var(--muted-foreground)"
                letterSpacing="0.01em"
              >
                {e.label}
              </text>
            </g>
          </g>
        );
      })}

      {NODES.map((n) => {
        const w = W(n.label);
        const hub = "hub" in n && n.hub;
        return (
          <g key={n.id} transform={`translate(${n.x - w / 2} ${n.y - 16})`}>
            <rect
              width={w}
              height={32}
              rx={8}
              fill={hub ? "var(--primary)" : "var(--card)"}
              stroke={hub ? "none" : "var(--border)"}
            />
            <circle
              cx={14}
              cy={16}
              r={3.5}
              fill={hub ? "var(--primary-foreground)" : "var(--primary)"}
              opacity={hub ? 0.9 : 0.7}
            />
            <text
              x={24}
              y={20.5}
              fontSize="12"
              fontWeight={500}
              fill={hub ? "var(--primary-foreground)" : "var(--foreground)"}
            >
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
