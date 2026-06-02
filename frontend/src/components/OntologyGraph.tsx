import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { forceCollide, forceX, forceY } from "d3-force";
import { Crosshair, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode, Ontology } from "../types/oag";
import {
  buildRelationshipGraphModel,
  getObjectKindColor,
  getRelationState,
  isGraphFocusNode,
  type OntologyGraphLink,
} from "../lib/ontologyGraph";

type OntologyGraphProps = {
  ontology: Ontology | null;
  selectedObject: string | null;
  onSelectObject: (name: string) => void;
};

type ForceNode = NodeObject<GraphNode>;
type ForceLink = LinkObject<GraphNode, OntologyGraphLink>;
type ForceGraphData = {
  nodes: ForceNode[];
  links: OntologyGraphLink[];
};
type AdjustableForce<T> = {
  distance?: (value: number | ((item: T) => number)) => unknown;
  distanceMax?: (value: number) => unknown;
  strength?: (value: number | ((item: T) => number)) => unknown;
};
type GraphForce = ((alpha: number) => void) & {
  initialize?: (nodes: ForceNode[], ...args: unknown[]) => void;
};

const legendKinds = ["entity", "rule_table", "lookup_table", "config"];
const graphHeight = 500;
const defaultGraphWidth = 720;

export function OntologyGraph({ ontology, selectedObject, onSelectObject }: OntologyGraphProps) {
  const graphRef = useRef<ForceGraphMethods<GraphNode, OntologyGraphLink>>();
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphWidth, setGraphWidth] = useState(defaultGraphWidth);
  const graph = useMemo(() => buildRelationshipGraphModel(ontology, selectedObject), [ontology, selectedObject]);
  const forceGraph = useMemo(() => seedGraphPositions(graph, selectedObject), [graph, selectedObject]);
  const relationState = useMemo(
    () => getRelationState(ontology, selectedObject),
    [ontology, selectedObject],
  );
  const selectedId = selectedObject ?? "";
  const hasActiveSelection = relationState.activeLinkIds.size > 0;

  useEffect(() => {
    const container = graphContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width > 0) setGraphWidth(width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const instance = graphRef.current;
      if (!instance) return;

      const linkForce = instance.d3Force("link") as AdjustableForce<ForceLink> | undefined;
      linkForce?.distance?.((link) => (isLinkActive(link, relationState.activeLinkIds) ? 185 : 165));
      linkForce?.strength?.(0.78);

      const chargeForce = instance.d3Force("charge") as AdjustableForce<ForceNode> | undefined;
      chargeForce?.strength?.(-560);
      chargeForce?.distanceMax?.(720);

      instance.d3Force(
        "collide",
        forceCollide<ForceNode>()
          .radius((node) => (node.id === selectedObject ? 76 : 62))
          .strength(0.9)
          .iterations(2) as unknown as GraphForce,
      );
      instance.d3Force("x", forceX<ForceNode>().strength(0.035) as unknown as GraphForce);
      instance.d3Force("y", forceY<ForceNode>().strength(0.045) as unknown as GraphForce);
      instance.d3ReheatSimulation();
      instance.zoomToFit(260, 78);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [forceGraph, relationState.activeLinkIds, selectedObject]);

  if (!graph.links.length) {
    return (
      <div className="ontology-graph-frame ontology-graph-empty">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>暂无显式关系</div>
          <p className="mt-2 max-w-md text-sm leading-6" style={{ color: "var(--text-faint)" }}>
            当前 domain 没有定义 ontology links。本页只展示显式关系，不从字段或业务函数推断隐式关系。
          </p>
        </div>
      </div>
    );
  }

  function resetView() {
    graphRef.current?.zoomToFit(450, 42);
  }

function focusSelected() {
    if (!selectedObject) {
      resetView();
      return;
    }
    graphRef.current?.zoomToFit(500, 80, (node) => (
      isGraphFocusNode(node, selectedObject, relationState.neighborIds)
    ));
  }

  return (
    <div className="ontology-graph-frame">
      <div className="ontology-graph-toolbar">
        <div className="ontology-legend">
          {legendKinds.map((kind) => (
            <span key={kind} className="ontology-legend-item">
              <span className="ontology-legend-swatch" style={{ background: getObjectKindColor(kind) }} />
              {kind}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="icon-button" title="聚焦选中节点" onClick={focusSelected} disabled={!selectedObject}>
            <Crosshair className="h-4 w-4" />
          </button>
          <button type="button" className="icon-button" title="重置视图" onClick={resetView}>
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="ontology-force-graph" ref={graphContainerRef}>
        <ForceGraph2D
          ref={graphRef}
          graphData={forceGraph}
          width={graphWidth}
          height={graphHeight}
          backgroundColor="rgba(0,0,0,0)"
          nodeId="id"
          nodeRelSize={5}
          nodeVal={(node) => (isNodeSelected(node, selectedId) ? 4.2 : 2.8)}
          nodeLabel={(node) => `${node.label} · ${node.kind}`}
          nodeColor={(node) => node.color}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(node, ctx, globalScale) => paintNode(node, ctx, globalScale, selectedId, relationState.neighborIds, hasActiveSelection)}
          nodePointerAreaPaint={(node, color, ctx) => paintNodeHitArea(node, color, ctx)}
          linkSource="source"
          linkTarget="target"
          linkLabel={(link) => `${link.type || link.label}\n${link.label}`}
          linkColor={(link) => getLinkColor(link, relationState.activeLinkIds, hasActiveSelection)}
          linkWidth={(link) => (isLinkActive(link, relationState.activeLinkIds) ? 2.8 : 1.15)}
          linkCurvature={(link) => getLinkCurvature(link)}
          linkDirectionalArrowLength={(link) => (isLinkActive(link, relationState.activeLinkIds) ? 8 : 5)}
          linkDirectionalArrowRelPos={0.92}
          linkDirectionalArrowColor={(link) => getLinkColor(link, relationState.activeLinkIds, hasActiveSelection)}
          linkDirectionalParticles={(link) => (isLinkActive(link, relationState.activeLinkIds) ? 2 : 0)}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleWidth={2.2}
          linkDirectionalParticleColor={() => getCssVar("--accent-strong", "#2bd68d")}
          linkCanvasObjectMode={() => "replace"}
          linkCanvasObject={(link, ctx, globalScale) => paintRelationshipLink(link, ctx, globalScale, relationState.activeLinkIds, hasActiveSelection)}
          linkPointerAreaPaint={(link, color, ctx) => paintLinkPointerArea(link, color, ctx)}
          warmupTicks={0}
          cooldownTicks={60}
          d3AlphaDecay={0.022}
          d3VelocityDecay={0.28}
          onRenderFramePre={(ctx, globalScale) => paintGraphBackground(ctx, globalScale)}
          onEngineStop={() => graphRef.current?.zoomToFit(260, 78)}
          onNodeClick={(node) => onSelectObject(String(node.id))}
          onLinkClick={(link) => {
            const source = toNodeId(link.source);
            if (source) onSelectObject(source);
          }}
          enableNodeDrag
          enableZoomInteraction
          enablePanInteraction
        />
      </div>
    </div>
  );
}

function paintNode(node: ForceNode, ctx: CanvasRenderingContext2D, globalScale: number,
                   selectedId: string, neighborIds: Set<string>, hasActiveSelection: boolean) {
  const id = String(node.id ?? "");
  const selected = id === selectedId;
  const neighbor = neighborIds.has(id);
  const dim = hasActiveSelection && !selected && !neighbor;
  const radius = selected ? 13 : 10;
  const label = String(node.summary || node.label || node.id || "");
  const objectName = String(node.label ?? node.id ?? "");
  const fontSize = Math.max(10, 13 / globalScale);
  const labelWidth = Math.min(150, Math.max(64, ctx.measureText(label).width + 28));
  const x = Number(node.x ?? 0);
  const y = Number(node.y ?? 0);

  ctx.save();
  ctx.globalAlpha = dim ? 0.28 : 1;
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 8, 0, 2 * Math.PI);
    ctx.fillStyle = getCssVar("--accent-soft", "rgba(26, 163, 111, 0.14)");
    ctx.fill();
    ctx.lineWidth = Math.max(1.6, 2.5 / globalScale);
    ctx.strokeStyle = getCssVar("--accent-strong", "#2bd68d");
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = String(node.color ?? "#8f98a6");
  ctx.fill();
  ctx.lineWidth = selected ? 3 : 1.4;
  ctx.strokeStyle = selected ? getCssVar("--accent-strong", "#2bd68d") : getCssVar("--line", "#303743");
  ctx.stroke();

  ctx.font = `700 ${fontSize}px Inter, ui-sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(3, 4 / globalScale);
  ctx.strokeStyle = getCssVar("--bg", "#0b0d10");
  ctx.fillStyle = getCssVar("--text", "#f4f6f8");
  const labelLines = splitNodeLabel(label);
  labelLines.forEach((line, index) => {
    const lineY = y + radius + 17 + index * Math.max(11, 13 / globalScale);
    ctx.strokeText(line, x, lineY, labelWidth);
    ctx.fillText(line, x, lineY, labelWidth);
  });

  ctx.font = `600 ${Math.max(8, 10 / globalScale)}px Inter, ui-sans-serif`;
  ctx.strokeStyle = getCssVar("--bg", "#0b0d10");
  ctx.fillStyle = getCssVar("--text-faint", "#737d8c");
  const metaText = label === objectName ? String(node.kind ?? "entity") : `${objectName} · ${String(node.kind ?? "entity")}`;
  const kindY = y + radius + 18 + labelLines.length * Math.max(11, 13 / globalScale);
  ctx.strokeText(metaText, x, kindY, labelWidth);
  ctx.fillText(metaText, x, kindY, labelWidth);
  ctx.restore();
}

function paintNodeHitArea(node: ForceNode, color: string, ctx: CanvasRenderingContext2D) {
  const x = Number(node.x ?? 0);
  const y = Number(node.y ?? 0);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 28, 0, 2 * Math.PI);
  ctx.fill();
}

function paintRelationshipLink(link: ForceLink, ctx: CanvasRenderingContext2D, globalScale: number,
                               activeLinkIds: Set<string>, hasSelection: boolean) {
  const source = link.source as ForceNode;
  const target = link.target as ForceNode;
  if (typeof source !== "object" || typeof target !== "object") return;

  const active = isLinkActive(link, activeLinkIds);
  const points = getCurvePoints(link, source, target);
  if (!points) return;

  const label = String(link.type || link.label || "");
  const color = getLinkColor(link, activeLinkIds, hasSelection);
  const alpha = hasSelection && !active ? 0.24 : active ? 1 : 0.82;
  const width = (active ? 3.1 : 1.65) / Math.max(0.65, globalScale);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (hasSelection && !active) ctx.setLineDash([6 / globalScale, 8 / globalScale]);
  ctx.beginPath();
  ctx.moveTo(points.start.x, points.start.y);
  ctx.quadraticCurveTo(points.control.x, points.control.y, points.end.x, points.end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  const arrowPoint = quadraticPoint(points, 0.92);
  const arrowTangent = quadraticTangent(points, 0.92);
  paintArrowHead(ctx, arrowPoint.x, arrowPoint.y, Math.atan2(arrowTangent.y, arrowTangent.x), color, active, globalScale);

  if (!hasSelection || active) {
    const labelPoint = quadraticPoint(points, 0.52);
    const tangent = quadraticTangent(points, 0.52);
    paintLinkText(ctx, label, labelPoint.x, labelPoint.y, Math.atan2(tangent.y, tangent.x), color, active, globalScale);
  }
  ctx.restore();
}

function paintLinkPointerArea(link: ForceLink, color: string, ctx: CanvasRenderingContext2D) {
  const source = link.source as ForceNode;
  const target = link.target as ForceNode;
  if (typeof source !== "object" || typeof target !== "object") return;

  const points = getCurvePoints(link, source, target);
  if (!points) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points.start.x, points.start.y);
  ctx.quadraticCurveTo(points.control.x, points.control.y, points.end.x, points.end.y);
  ctx.stroke();
  ctx.restore();
}

function paintGraphBackground(ctx: CanvasRenderingContext2D, globalScale: number) {
  const canvas = ctx.canvas;
  const dotSpacing = Math.max(16, Math.min(26, 22 * Math.sqrt(globalScale || 1)));

  ctx.save();
  if (typeof ctx.resetTransform === "function") {
    ctx.resetTransform();
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  ctx.fillStyle = getCssVar("--bg", "#0b0d10");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getCssVar("--line-soft", "#232a34");
  ctx.globalAlpha = 0.72;
  for (let x = 10; x < canvas.width; x += dotSpacing) {
    for (let y = 10; y < canvas.height; y += dotSpacing) {
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintArrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number,
                        color: string, active: boolean, globalScale: number) {
  const size = (active ? 10.5 : 8) / Math.max(0.75, globalScale);
  const spread = 0.48;

  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(angle - spread), y - size * Math.sin(angle - spread));
  ctx.lineTo(x - size * 0.42 * Math.cos(angle), y - size * 0.42 * Math.sin(angle));
  ctx.lineTo(x - size * Math.cos(angle + spread), y - size * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintLinkText(ctx: CanvasRenderingContext2D, label: string, x: number, y: number,
                       angle: number, color: string, active: boolean, globalScale: number) {
  const fontSize = Math.max(8, 11 / globalScale);
  const readableAngle = angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(readableAngle);
  ctx.font = `700 ${fontSize}px Inter, ui-sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(3, 4 / globalScale);
  ctx.strokeStyle = getCssVar("--bg", "#0b0d10");
  ctx.fillStyle = active ? getCssVar("--accent-strong", "#2bd68d") : color;
  ctx.strokeText(label, 0, -7 / globalScale, 116 / globalScale);
  ctx.fillText(label, 0, -7 / globalScale, 116 / globalScale);
  ctx.restore();
}

function getLinkColor(link: ForceLink, activeLinkIds: Set<string>, hasSelection: boolean) {
  if (isLinkActive(link, activeLinkIds)) return getCssVar("--accent-strong", "#2bd68d");
  return hasSelection ? "rgba(115, 125, 140, 0.34)" : getRelationColor(link);
}

function getRelationColor(link: ForceLink) {
  const palette = [
    "#4f9cff",
    "#8f7cff",
    "#23bfa5",
    "#e1a13a",
    "#d66bc4",
    "#5bbf59",
  ];
  return palette[hashString(String(link.id || link.label || link.type || "")) % palette.length];
}

function getLinkCurvature(link: ForceLink) {
  const hash = hashString(String(link.id || link.label || ""));
  const sign = hash % 2 === 0 ? 1 : -1;
  return sign * (0.16 + (hash % 3) * 0.035);
}

function getCurvePoints(link: ForceLink, source: ForceNode, target: ForceNode) {
  const sx = Number(source.x ?? 0);
  const sy = Number(source.y ?? 0);
  const tx = Number(target.x ?? 0);
  const ty = Number(target.y ?? 0);
  const dx = tx - sx;
  const dy = ty - sy;
  const distance = Math.hypot(dx, dy);

  if (!Number.isFinite(distance) || distance < 1) return null;

  const unitX = dx / distance;
  const unitY = dy / distance;
  const sourceRadius = 18;
  const targetRadius = 21;
  const start = {
    x: sx + unitX * sourceRadius,
    y: sy + unitY * sourceRadius,
  };
  const end = {
    x: tx - unitX * targetRadius,
    y: ty - unitY * targetRadius,
  };
  const curve = getLinkCurvature(link);
  const curveOffset = Math.max(-88, Math.min(88, distance * curve));
  const control = {
    x: (start.x + end.x) / 2 - unitY * curveOffset,
    y: (start.y + end.y) / 2 + unitX * curveOffset,
  };

  return { start, control, end };
}

function quadraticPoint(points: NonNullable<ReturnType<typeof getCurvePoints>>, t: number) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * points.start.x + 2 * oneMinusT * t * points.control.x + t * t * points.end.x,
    y: oneMinusT * oneMinusT * points.start.y + 2 * oneMinusT * t * points.control.y + t * t * points.end.y,
  };
}

function quadraticTangent(points: NonNullable<ReturnType<typeof getCurvePoints>>, t: number) {
  return {
    x: 2 * (1 - t) * (points.control.x - points.start.x) + 2 * t * (points.end.x - points.control.x),
    y: 2 * (1 - t) * (points.control.y - points.start.y) + 2 * t * (points.end.y - points.control.y),
  };
}

function splitNodeLabel(label: string) {
  const words = label.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [label];

  const first = words.slice(0, Math.ceil(words.length / 2)).join(" ");
  const second = words.slice(Math.ceil(words.length / 2)).join(" ");
  return [first, second];
}

function seedGraphPositions(graph: { nodes: GraphNode[]; links: OntologyGraphLink[] }, selectedObject: string | null): ForceGraphData {
  const degree = new Map<string, number>();
  for (const link of graph.links) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  const linkedIds = new Set(degree.keys());

  const selectedHasLinks = Boolean(selectedObject && degree.get(selectedObject));
  const centerId = selectedHasLinks && graph.nodes.some((node) => node.id === selectedObject)
    ? selectedObject
    : [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))[0]?.id;
  const neighborIds = new Set<string>();
  for (const link of graph.links) {
    if (link.source === centerId) neighborIds.add(link.target);
    if (link.target === centerId) neighborIds.add(link.source);
  }
  const linkedNodes = graph.nodes.filter((node) => linkedIds.has(node.id) && node.id !== centerId);
  const isolatedNodes = graph.nodes.filter((node) => !linkedIds.has(node.id));

  const nodes = graph.nodes.map((node, index) => {
    if (node.id === centerId) return { ...node, x: 0, y: 0, fx: 0, fy: 0 };

    const neighborIndex = [...neighborIds].indexOf(node.id);
    const linkedIndex = linkedNodes.findIndex((item) => item.id === node.id);
    const isolatedIndex = isolatedNodes.findIndex((item) => item.id === node.id);
    const totalNeighbors = Math.max(1, neighborIds.size || linkedNodes.length);
    const orbitIndex = neighborIndex >= 0 ? neighborIndex : linkedIndex >= 0 ? linkedIndex : isolatedIndex;
    const orbitTotal = neighborIndex >= 0 ? totalNeighbors : linkedIndex >= 0 ? Math.max(1, linkedNodes.length) : Math.max(1, isolatedNodes.length);
    const radius = neighborIndex >= 0 ? 155 : linkedIndex >= 0 ? 190 : 255;
    const startAngle = neighborIndex >= 0 || linkedIndex >= 0 ? -Math.PI / 2 : -Math.PI * 0.82;
    const angle = startAngle + (Math.max(0, orbitIndex) / orbitTotal) * Math.PI * 2;
    return {
      ...node,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      fx: Math.cos(angle) * radius,
      fy: Math.sin(angle) * radius,
    };
  });

  return {
    nodes,
    links: graph.links.map((link) => ({ ...link })),
  };
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function isNodeSelected(node: ForceNode, selectedId: string) {
  return Boolean(selectedId && node.id === selectedId);
}

function isLinkActive(link: ForceLink, activeLinkIds: Set<string>) {
  return Boolean(link.id && activeLinkIds.has(String(link.id)));
}

function toNodeId(node: string | number | ForceNode | undefined) {
  if (typeof node === "object") return String(node.id ?? "");
  if (node == null) return "";
  return String(node);
}

function getCssVar(name: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
