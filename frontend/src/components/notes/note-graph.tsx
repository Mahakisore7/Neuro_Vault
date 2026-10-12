"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { EASE_OUT } from "@/components/motion";
import type { NoteGraph as NoteGraphData, RelationshipType } from "@/types/api";

const VIEWBOX = 640;
const CENTER = VIEWBOX / 2;
const MAX_RADIUS = 260;
const NODE_RADIUS = 9;
const ROOT_RADIUS = 14;

interface PositionedNode {
  id: string;
  title: string;
  isPublic: boolean;
  depth: number;
  x: number;
  y: number;
}

// Concentric rings by depth — not an arbitrary force layout. This is the
// SAME structure the recursive CTE builds one BFS layer at a time (see
// docs/phases/New/03-SQL-LAYER.md §3.6): ring 0 is the anchor, each ring out
// is one more hop, which is exactly what "depth" already means in the API
// response. The layout is the query's own execution order, drawn.
function layoutNodes(nodes: NoteGraphData["nodes"], rootId: string): PositionedNode[] {
  const byDepth = new Map<number, NoteGraphData["nodes"]>();
  for (const node of nodes) {
    const ring = byDepth.get(node.depth) ?? [];
    ring.push(node);
    byDepth.set(node.depth, ring);
  }
  const maxDepth = Math.max(1, ...byDepth.keys());

  const positioned: PositionedNode[] = [];
  for (const [depth, ring] of byDepth) {
    const sorted = [...ring].sort((a, b) => a.title.localeCompare(b.title));
    const radius = (depth / maxDepth) * MAX_RADIUS;
    sorted.forEach((node, i) => {
      // Rotate each ring a bit relative to the last so nodes at different
      // depths don't line up on the same spokes, purely for legibility.
      const angleOffset = depth * 0.6;
      const angle = (2 * Math.PI * i) / sorted.length + angleOffset;
      const x = node.id === rootId ? CENTER : CENTER + radius * Math.cos(angle);
      const y = node.id === rootId ? CENTER : CENTER + radius * Math.sin(angle);
      positioned.push({ id: node.id, title: node.title, isPublic: node.is_public, depth, x, y });
    });
  }
  return positioned;
}

export function NoteGraph({
  graph,
  rootId,
  relationshipTypes,
  highlightPath = [],
}: {
  graph: NoteGraphData;
  rootId: string;
  relationshipTypes: RelationshipType[];
  /** Note ids of a shortest path, in order; drawn on top, everything else dimmed. */
  highlightPath?: string[];
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  // The note under the pointer (or keyboard focus): it and its direct
  // neighbours stay lit while the rest of the graph recedes.
  const [hovered, setHovered] = useState<string | null>(null);
  const positioned = useMemo(() => layoutNodes(graph.nodes, rootId), [graph.nodes, rootId]);
  const byId = useMemo(() => new Map(positioned.map((n) => [n.id, n])), [positioned]);
  const relTypeById = useMemo(
    () => new Map(relationshipTypes.map((t) => [t.id, t])),
    [relationshipTypes],
  );
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const e of graph.edges) {
      if (!map.has(e.source_note_id)) map.set(e.source_note_id, new Set());
      if (!map.has(e.target_note_id)) map.set(e.target_note_id, new Set());
      map.get(e.source_note_id)!.add(e.target_note_id);
      map.get(e.target_note_id)!.add(e.source_note_id);
    }
    return map;
  }, [graph.edges]);

  const usedRelTypeIds = [...new Set(graph.edges.map((e) => e.rel_type_id))];

  const onPath = new Set(highlightPath);
  // Consecutive pairs, either direction - the path is undirected.
  const pathEdges = new Set(
    highlightPath
      .slice(1)
      .flatMap((id, i) => [`${highlightPath[i]}>${id}`, `${id}>${highlightPath[i]}`]),
  );
  const dimming = highlightPath.length > 1;
  const focusing = hovered !== null && !dimming;
  const lit = (id: string) => !focusing || id === hovered || neighbours.get(hovered!)?.has(id);

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className="h-full w-full"
      role="img"
      aria-label={`Knowledge graph centered on the current note, ${graph.nodes.length} notes, ${graph.edges.length} connections`}
    >
      <defs>
        {usedRelTypeIds.map((id) => {
          const color = relTypeById.get(id)?.color ?? "#888888";
          return (
            <marker
              key={id}
              id={`nv-arrow-${id}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          );
        })}
      </defs>

      {/* Depth rings, faint — visual scaffolding, not data */}
      {[...new Set(positioned.map((n) => n.depth))]
        .filter((d) => d > 0)
        .map((d) => (
          <circle
            key={d}
            cx={CENTER}
            cy={CENTER}
            r={(d / Math.max(1, ...positioned.map((n) => n.depth))) * MAX_RADIUS}
            fill="none"
            stroke="var(--border)"
            strokeDasharray="2 4"
          />
        ))}

      {graph.edges.map((edge) => {
        const source = byId.get(edge.source_note_id);
        const target = byId.get(edge.target_note_id);
        if (!source || !target) return null;
        const relType = relTypeById.get(edge.rel_type_id);
        const isPathEdge = pathEdges.has(`${edge.source_note_id}>${edge.target_note_id}`);
        const touchesFocus =
          focusing && (edge.source_note_id === hovered || edge.target_note_id === hovered);
        const opacity = dimming
          ? isPathEdge
            ? 0.9
            : 0.15
          : focusing
            ? touchesFocus
              ? 0.95
              : 0.1
            : 0.7;
        return (
          <motion.line
            key={edge.id}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            stroke={isPathEdge ? "var(--primary)" : (relType?.color ?? "#888888")}
            strokeWidth={isPathEdge || touchesFocus ? 3 : 0.8 + edge.strength * 0.25}
            strokeLinecap="round"
            markerEnd={relType?.is_symmetric ? undefined : `url(#nv-arrow-${edge.rel_type_id})`}
            // The links draw themselves outward, a ring at a time.
            initial={reduce ? false : { pathLength: 0, strokeOpacity: 0 }}
            animate={{ pathLength: 1, strokeOpacity: opacity }}
            transition={{
              pathLength: {
                duration: 0.7,
                ease: EASE_OUT,
                delay: 0.15 * Math.max(source.depth, target.depth),
              },
              strokeOpacity: { duration: 0.25 },
            }}
          />
        );
      })}

      {positioned.map((node) => {
        const isRoot = node.id === rootId;
        const pathFaded = dimming && !onPath.has(node.id);
        const dimmed = pathFaded || (focusing && !lit(node.id));
        const r = isRoot ? ROOT_RADIUS : NODE_RADIUS;
        return (
          <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
            <motion.g
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: dimmed ? 0.3 : 1, y: 0 }}
              transition={{
                opacity: {
                  duration: 0.25,
                  delay: reduce || hovered !== null ? 0 : 0.12 * node.depth,
                },
                y: { duration: 0.5, ease: EASE_OUT, delay: 0.12 * node.depth },
              }}
              className="cursor-pointer outline-none"
              tabIndex={isRoot ? undefined : 0}
              role={isRoot ? undefined : "link"}
              aria-label={isRoot ? undefined : node.title}
              onClick={() => !isRoot && router.push(`/notes/${node.id}`)}
              onKeyDown={(e: React.KeyboardEvent) => {
                if (!isRoot && e.key === "Enter") router.push(`/notes/${node.id}`);
              }}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(node.id)}
              onBlur={() => setHovered(null)}
            >
              <title>{node.title}</title>
              {isRoot && <circle r={r + 9} fill="var(--primary)" opacity={0.14} />}
              <circle
                r={r}
                fill={isRoot ? "var(--primary)" : "var(--card)"}
                stroke={
                  isRoot || node.id === hovered || (dimming && onPath.has(node.id))
                    ? "var(--primary)"
                    : "var(--border)"
                }
                strokeWidth={dimming && onPath.has(node.id) ? 3 : node.id === hovered ? 2.5 : 1.5}
              />
              <text
                y={r + 17}
                textAnchor="middle"
                fontSize={isRoot ? 13 : 11.5}
                fontWeight={isRoot || node.id === hovered ? 600 : 500}
                fill="var(--foreground)"
                // A halo in the page colour keeps labels readable where
                // they cross a link.
                stroke="var(--background)"
                strokeWidth={4}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title}
              </text>
            </motion.g>
          </g>
        );
      })}
    </svg>
  );
}
