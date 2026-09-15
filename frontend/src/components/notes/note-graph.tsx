"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";

import type { NoteGraph as NoteGraphData, RelationshipType } from "@/types/api";

const VIEWBOX = 640;
const CENTER = VIEWBOX / 2;
const MAX_RADIUS = 260;
const NODE_RADIUS = 8;
const ROOT_RADIUS = 13;

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
}: {
  graph: NoteGraphData;
  rootId: string;
  relationshipTypes: RelationshipType[];
}) {
  const router = useRouter();
  const positioned = useMemo(() => layoutNodes(graph.nodes, rootId), [graph.nodes, rootId]);
  const byId = useMemo(() => new Map(positioned.map((n) => [n.id, n])), [positioned]);
  const relTypeById = useMemo(
    () => new Map(relationshipTypes.map((t) => [t.id, t])),
    [relationshipTypes],
  );

  const usedRelTypeIds = [...new Set(graph.edges.map((e) => e.rel_type_id))];

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
        return (
          <line
            key={edge.id}
            x1={source.x}
            y1={source.y}
            x2={target.x}
            y2={target.y}
            stroke={relType?.color ?? "#888888"}
            strokeWidth={0.8 + edge.strength * 0.25}
            strokeOpacity={0.7}
            markerEnd={relType?.is_symmetric ? undefined : `url(#nv-arrow-${edge.rel_type_id})`}
          />
        );
      })}

      {positioned.map((node) => {
        const isRoot = node.id === rootId;
        return (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            className="cursor-pointer"
            onClick={() => !isRoot && router.push(`/notes/${node.id}`)}
          >
            <title>{node.title}</title>
            <circle
              r={isRoot ? ROOT_RADIUS : NODE_RADIUS}
              fill={isRoot ? "var(--primary)" : "var(--card)"}
              stroke={isRoot ? "var(--primary)" : "var(--border)"}
              strokeWidth={1.5}
            />
            <text
              y={isRoot ? ROOT_RADIUS + 16 : NODE_RADIUS + 14}
              textAnchor="middle"
              fontSize={isRoot ? 13 : 11}
              fontWeight={isRoot ? 600 : 400}
              fill="var(--foreground)"
            >
              {node.title.length > 20 ? `${node.title.slice(0, 19)}…` : node.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
