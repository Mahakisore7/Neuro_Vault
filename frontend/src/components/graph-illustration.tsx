"use client";

import { motion, useReducedMotion } from "motion/react";

import { EASE_OUT } from "@/components/motion";
import { cn } from "@/lib/utils";

// A picture of what the app does: notes as chips joined by typed, directed
// links. The edges draw themselves, the notes fade in and drift, and a pulse
// travels along the strong links. Decorative (aria-hidden), drawn with theme
// tokens so it holds up in light and dark, and still under reduced motion.
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
  const reduce = useReducedMotion();
  const at = (id: string) => NODES.find((n) => n.id === id)!;

  return (
    <svg
      aria-hidden
      viewBox="0 0 520 310"
      className={cn("h-auto overflow-visible", className)}
      fontFamily="var(--font-sans)"
    >
      {EDGES.map((e, i) => {
        const a = at(e.from);
        const b = at(e.to);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g key={e.from + e.to}>
            <motion.line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={e.strong ? "var(--primary)" : "var(--muted-foreground)"}
              strokeOpacity={e.strong ? 0.55 : 0.35}
              strokeWidth={e.strong ? 1.75 : 1.25}
              strokeDasharray={e.strong ? undefined : "4 4"}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.35 + i * 0.12 }}
            />
            {/* A pulse of "something flowing" along the strong links. */}
            {e.strong && !reduce && (
              <circle r="3" fill="var(--primary)" opacity="0.9">
                <animateMotion
                  dur="3.4s"
                  begin={`${1.6 + i * 0.5}s`}
                  repeatCount="indefinite"
                  path={`M${a.x} ${a.y} L${b.x} ${b.y}`}
                />
              </circle>
            )}
            <g transform={`translate(${mx} ${my})`}>
              <motion.g
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.9 + i * 0.12 }}
              >
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
              </motion.g>
            </g>
          </g>
        );
      })}

      {NODES.map((n, i) => {
        const w = W(n.label);
        const hub = "hub" in n && n.hub;
        return (
          <g key={n.id} transform={`translate(${n.x - w / 2} ${n.y - 16})`}>
            <motion.g
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE_OUT, delay: i * 0.1 }}
            >
              <g
                className="animate-float"
                style={{ animationDelay: `${-i * 1.4}s`, animationDuration: `${6 + i}s` }}
              >
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
            </motion.g>
          </g>
        );
      })}
    </svg>
  );
}
