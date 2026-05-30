import ForceGraph2D from "react-force-graph-2d";
import { useMemo } from "react";
import type { GraphLink, GraphNode, Ontology } from "../types/oag";

type OntologyGraphProps = {
  ontology: Ontology | null;
  onSelectObject: (name: string) => void;
};

const colors: Record<string, string> = {
  entity: "#34d399",
  rule_table: "#fbbf24",
  lookup_table: "#38bdf8",
  config: "#c084fc"
};

export function OntologyGraph({ ontology, onSelectObject }: OntologyGraphProps) {
  const graph = useMemo(() => {
    const nodes: GraphNode[] = Object.entries(ontology?.objects ?? {}).map(([id, object]) => ({
      id,
      label: id,
      kind: object.kind ?? "entity",
      value: Math.max(5, Object.keys(object.properties ?? {}).length + 5),
      color: colors[object.kind ?? "entity"] ?? "#a1a1aa"
    }));
    const links: GraphLink[] = Object.entries(ontology?.links ?? {}).map(([name, link]) => ({
      source: link.source,
      target: link.target,
      label: name,
      type: link.link_type
    }));
    return { nodes, links };
  }, [ontology]);

  return (
    <div className="h-[420px] overflow-hidden rounded border border-zinc-800 bg-zinc-950">
      <ForceGraph2D
        graphData={graph}
        backgroundColor="#09090b"
        nodeRelSize={5}
        nodeLabel={(node) => `${(node as GraphNode).label} · ${(node as GraphNode).kind}`}
        linkLabel={(link) => (link as GraphLink).label}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const item = node as GraphNode & { x: number; y: number };
          const label = item.label;
          const fontSize = Math.max(9, 13 / globalScale);
          ctx.beginPath();
          ctx.arc(item.x, item.y, item.value, 0, 2 * Math.PI, false);
          ctx.fillStyle = item.color;
          ctx.fill();
          ctx.font = `${fontSize}px Inter, ui-sans-serif`;
          ctx.fillStyle = "#e4e4e7";
          ctx.textAlign = "center";
          ctx.fillText(label, item.x, item.y + item.value + fontSize + 2);
        }}
        linkColor={() => "#3f3f46"}
        linkDirectionalParticles={1}
        linkDirectionalParticleSpeed={0.004}
        onNodeClick={(node) => onSelectObject((node as GraphNode).id)}
      />
    </div>
  );
}
