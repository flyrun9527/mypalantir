import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Ontology } from "../../src/types/oag";
import { OntologyGraph } from "../../src/components/OntologyGraph";

const forceGraphProps: Record<string, unknown>[] = [];

vi.mock("react-force-graph-2d", () => ({
  default: vi.fn((props: Record<string, unknown>) => {
    forceGraphProps.push(props);
    return <div data-testid="force-graph" />;
  }),
}));

const ontology: Ontology = {
  name: "test",
  objects: {
    AccessRequest: { kind: "entity", properties: {} },
    AccessPlan: { kind: "entity", properties: {} },
    Busbar: { kind: "entity", summary: "母线", properties: {} },
    Substation: { kind: "entity", properties: {} },
  },
  links: {
    request_has_plans: {
      source: "AccessRequest",
      target: "AccessPlan",
      link_type: "contains",
    },
  },
};

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  emit(width: number) {
    this.callback([
      { contentRect: { width } } as ResizeObserverEntry,
    ], this as unknown as ResizeObserver);
  }
}

describe("OntologyGraph", () => {
  beforeEach(() => {
    forceGraphProps.length = 0;
    ResizeObserverMock.instances = [];
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders ontology links with react-force-graph-2d relationship affordances", () => {
    render(<OntologyGraph ontology={ontology} selectedObject="AccessRequest" onSelectObject={() => {}} />);

    expect(screen.getByTestId("force-graph")).toBeInTheDocument();
    const props = forceGraphProps[0];
    const graphData = props.graphData as { nodes: unknown[]; links: Array<{ id: string; source: string; target: string; type?: string }> };

    expect(graphData.nodes).toHaveLength(4);
    expect(graphData.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "AccessRequest", x: 0, y: 0, fx: 0, fy: 0 }),
      expect.objectContaining({ id: "AccessPlan", fx: expect.any(Number), fy: expect.any(Number) }),
      expect.objectContaining({ id: "Busbar", summary: "母线", fx: expect.any(Number), fy: expect.any(Number) }),
      expect.objectContaining({ id: "Substation", fx: expect.any(Number), fy: expect.any(Number) }),
    ]));
    expect(graphData.links).toEqual([
      expect.objectContaining({
        id: "request_has_plans",
        source: "AccessRequest",
        target: "AccessPlan",
        type: "contains",
      }),
    ]);
    expect(props.dagMode).toBeUndefined();
    expect(props.width).toBe(720);
    expect(props.linkDirectionalArrowLength).toBeTypeOf("function");
    expect(props.linkDirectionalParticles).toBeTypeOf("function");
    expect(props.linkLabel).toBeTypeOf("function");
    expect(props.linkCanvasObject).toBeTypeOf("function");
    expect((props.linkCanvasObjectMode as () => string)()).toBe("replace");
    expect(props.onRenderFramePre).toBeTypeOf("function");
    expect((props.linkLabel as (link: { label: string; type?: string }) => string)({ label: "request_has_plans", type: "contains" })).toContain("contains");
  });

  test("keeps the explicit relation graph readable when the selected object has no links", () => {
    render(<OntologyGraph ontology={ontology} selectedObject="Substation" onSelectObject={() => {}} />);

    const props = forceGraphProps[0];
    const graphData = props.graphData as { nodes: Array<{ id: string }>; links: Array<{ id: string; label: string; type?: string }> };

    expect(graphData.nodes.map((node) => node.id).sort()).toEqual(["AccessPlan", "AccessRequest", "Busbar", "Substation"]);
    expect((props.linkColor as (link: { id: string; label: string; type?: string }) => string)(graphData.links[0])).not.toBe("rgba(115, 125, 140, 0.34)");
  });

  test("includes and highlights isolated object nodes such as Busbar", () => {
    render(<OntologyGraph ontology={ontology} selectedObject="Busbar" onSelectObject={() => {}} />);

    const props = forceGraphProps[0];
    const graphData = props.graphData as { nodes: Array<{ id: string; summary?: string }>; links: Array<{ id: string; label: string; type?: string }> };
    const nodeVal = props.nodeVal as (node: { id: string }) => number;

    expect(graphData.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "Busbar", summary: "母线" }),
    ]));
    expect(nodeVal({ id: "Busbar" })).toBeGreaterThan(nodeVal({ id: "Substation" }));
    expect((props.linkColor as (link: { id: string; label: string; type?: string }) => string)(graphData.links[0])).not.toBe("rgba(115, 125, 140, 0.34)");
  });

  test("uses observed container width instead of the browser window width", () => {
    render(<OntologyGraph ontology={ontology} selectedObject="AccessRequest" onSelectObject={() => {}} />);

    act(() => ResizeObserverMock.instances[0].emit(590));

    expect(forceGraphProps.at(-1)?.width).toBe(590);
  });
});
