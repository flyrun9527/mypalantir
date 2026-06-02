import type { GraphLink, GraphNode, Ontology } from "../types/oag";

export type OntologyGraphLink = GraphLink & {
  id: string;
  description?: string;
  cardinality?: string;
};

export type OntologyGraphModel = {
  nodes: GraphNode[];
  links: OntologyGraphLink[];
};

export type ObjectRelation = OntologyGraphLink & {
  direction: "incoming" | "outgoing";
  relatedObject: string;
};

const colors: Record<string, string> = {
  entity: "#28b981",
  rule_table: "#dca628",
  lookup_table: "#2f92d0",
  config: "#9d7adf",
};

export function buildOntologyGraphModel(ontology: Ontology | null): OntologyGraphModel {
  const nodes: GraphNode[] = Object.entries(ontology?.objects ?? {}).map(([id, object]) => ({
    id,
    label: id,
    kind: object.kind ?? "entity",
    summary: object.summary,
    description: object.description,
    value: Math.max(8, Math.min(18, Object.keys(object.properties ?? {}).length + 8)),
    color: colors[object.kind ?? "entity"] ?? "#8f98a6",
  }));
  const links: OntologyGraphLink[] = Object.entries(ontology?.links ?? {})
    .filter(([, link]) => Boolean(link.source && link.target))
    .map(([id, link]) => ({
      id,
      source: link.source,
      target: link.target,
      label: id,
      type: link.link_type,
      description: link.description,
      cardinality: link.cardinality,
    }));
  return { nodes, links };
}

export function buildRelationshipGraphModel(ontology: Ontology | null, selectedObject: string | null): OntologyGraphModel {
  const graph = buildOntologyGraphModel(ontology);

  return {
    nodes: graph.nodes,
    links: graph.links,
  };
}

export function getRelationState(ontology: Ontology | null, selectedObject: string | null) {
  const graph = buildOntologyGraphModel(ontology);
  const activeLinkIds = new Set<string>();
  const neighborIds = new Set<string>();

  if (!selectedObject) {
    return { activeLinkIds, neighborIds };
  }

  for (const link of graph.links) {
    if (link.source === selectedObject) {
      activeLinkIds.add(link.id);
      neighborIds.add(link.target);
    } else if (link.target === selectedObject) {
      activeLinkIds.add(link.id);
      neighborIds.add(link.source);
    }
  }

  return { activeLinkIds, neighborIds };
}

export function getObjectRelations(ontology: Ontology | null, objectName: string | null) {
  const graph = buildOntologyGraphModel(ontology);
  const incoming: ObjectRelation[] = [];
  const outgoing: ObjectRelation[] = [];

  if (!objectName) return { incoming, outgoing };

  for (const link of graph.links) {
    if (link.source === objectName) {
      outgoing.push({ ...link, direction: "outgoing", relatedObject: link.target });
    }
    if (link.target === objectName) {
      incoming.push({ ...link, direction: "incoming", relatedObject: link.source });
    }
  }

  return { incoming, outgoing };
}

export function getObjectKindColor(kind: string | undefined): string {
  return colors[kind ?? "entity"] ?? "#8f98a6";
}

export function isGraphFocusNode(node: { id?: string | number }, selectedObject: string | null, neighborIds: Set<string>) {
  if (!selectedObject) return false;
  const nodeId = String(node.id ?? "");
  return nodeId === selectedObject || neighborIds.has(nodeId);
}
