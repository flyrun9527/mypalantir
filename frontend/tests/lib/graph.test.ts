import { describe, expect, test } from "vitest";
import type { Ontology } from "../../src/types/oag";
import {
  buildOntologyGraphModel,
  buildRelationshipGraphModel,
  getObjectRelations,
  getRelationState,
  isGraphFocusNode,
} from "../../src/lib/ontologyGraph";

const ontology: Ontology = {
  name: "hv_access",
  objects: {
    Substation: { kind: "entity", properties: { substation_id: { type: "str" } } },
    AccessRequest: { kind: "entity", properties: { request_id: { type: "str" } } },
    AccessPlan: { kind: "entity", properties: { plan_id: { type: "str" } } },
    Busbar: { kind: "entity", summary: "母线", properties: { busbar_id: { type: "str" } } },
    FeederLoadTransfer: { kind: "entity", properties: { transfer_id: { type: "str" } } },
    TransformerLoadTransfer: { kind: "entity", properties: { transfer_id: { type: "str" } } },
    NewFeederSuggestion: { kind: "entity", properties: { suggestion_id: { type: "str" } } },
    NoSolutionVerdict: { kind: "entity", properties: { verdict_id: { type: "str" } } },
    ImportanceLevelMap: { kind: "rule_table", properties: { industry_code: { type: "str" } } },
  },
  links: {
    request_has_plans: {
      source: "AccessRequest",
      target: "AccessPlan",
      link_type: "contains",
    },
    request_has_feeder_transfers: {
      source: "AccessRequest",
      target: "FeederLoadTransfer",
      link_type: "contains",
    },
    request_has_transformer_transfers: {
      source: "AccessRequest",
      target: "TransformerLoadTransfer",
      link_type: "contains",
    },
    request_has_new_feeder: {
      source: "AccessRequest",
      target: "NewFeederSuggestion",
      link_type: "contains",
    },
    request_has_no_solution: {
      source: "AccessRequest",
      target: "NoSolutionVerdict",
      link_type: "contains",
    },
  },
};

describe("ontology graph model", () => {
  test("builds graph nodes and explicit ontology links", () => {
    const graph = buildOntologyGraphModel(ontology);

    expect(graph.nodes).toHaveLength(9);
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "Busbar",
        label: "Busbar",
        summary: "母线",
      }),
    ]));
    expect(graph.links).toHaveLength(5);
    expect(graph.links[0]).toEqual(expect.objectContaining({
      id: "request_has_plans",
      source: "AccessRequest",
      target: "AccessPlan",
      label: "request_has_plans",
      type: "contains",
    }));
  });

  test("builds relationship graph from all objects and explicit ontology links", () => {
    const linkedGraph = buildRelationshipGraphModel(ontology, "AccessRequest");
    const isolatedSelectionGraph = buildRelationshipGraphModel(ontology, "Substation");
    const expectedObjectNodes = [
      "AccessPlan",
      "AccessRequest",
      "Busbar",
      "FeederLoadTransfer",
      "ImportanceLevelMap",
      "NewFeederSuggestion",
      "NoSolutionVerdict",
      "Substation",
      "TransformerLoadTransfer",
    ];

    expect(linkedGraph.nodes.map((node) => node.id).sort()).toEqual(expectedObjectNodes);
    expect(isolatedSelectionGraph.nodes.map((node) => node.id).sort()).toEqual(expectedObjectNodes);
    expect(isolatedSelectionGraph.links).toHaveLength(5);
  });

  test("identifies selected node neighbors and relation direction", () => {
    const relationState = getRelationState(ontology, "AccessRequest");
    const relations = getObjectRelations(ontology, "AccessRequest");

    expect([...relationState.neighborIds].sort()).toEqual([
      "AccessPlan",
      "FeederLoadTransfer",
      "NewFeederSuggestion",
      "NoSolutionVerdict",
      "TransformerLoadTransfer",
    ]);
    expect(relations.outgoing).toHaveLength(5);
    expect(relations.incoming).toHaveLength(0);
    expect(relations.outgoing[0]).toEqual(expect.objectContaining({
      id: "request_has_plans",
      target: "AccessPlan",
      type: "contains",
    }));
  });

  test("returns no explicit relations for disconnected objects", () => {
    const relationState = getRelationState(ontology, "Substation");
    const relations = getObjectRelations(ontology, "Substation");

    expect(relationState.activeLinkIds.size).toBe(0);
    expect(relationState.neighborIds.size).toBe(0);
    expect(relations.incoming).toEqual([]);
    expect(relations.outgoing).toEqual([]);
  });

  test("matches an isolated selected object as a graph focus node", () => {
    const relationState = getRelationState(ontology, "Busbar");

    expect(isGraphFocusNode({ id: "Busbar" }, "Busbar", relationState.neighborIds)).toBe(true);
    expect(isGraphFocusNode({ id: "AccessRequest" }, "Busbar", relationState.neighborIds)).toBe(false);
  });
});
