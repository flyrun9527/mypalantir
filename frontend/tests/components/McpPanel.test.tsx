import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { McpPanel } from "../../src/components/McpPanel";
import { api } from "../../src/lib/api";
import { useConsoleStore } from "../../src/store/useConsoleStore";

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (value?: string) => void }) => (
    <textarea
      aria-label="json-editor"
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
    />
  )
}));

vi.mock("../../src/lib/api", () => ({
  api: {
    callMcpTool: vi.fn()
  }
}));

describe("McpPanel", () => {
  beforeEach(() => {
    vi.mocked(api.callMcpTool).mockResolvedValue({
      domain: "hv_access",
      name: "count",
      result: { count: 3 },
      raw: "{\"count\":3}"
    });
    useConsoleStore.setState({
      currentDomain: "hv_access",
      mcpStatus: {
        status: "online",
        domain: "hv_access",
        endpoint: "http://127.0.0.1:8765/mcp",
        transport: "streamable-http",
        tool_count: 2,
        read_only_count: 1,
        write_count: 1,
        requires_confirmation_count: 1
      },
      mcpTools: [
        {
          name: "count",
          description: "Count objects",
          input_schema: {
            type: "object",
            properties: { object_type: { type: "string" } }
          },
          category: "query",
          read_only: true,
          requires_confirmation: false,
          policy: { read_only: true }
        },
        {
          name: "mutate",
          description: "Mutate objects",
          input_schema: { type: "object" },
          category: "action",
          read_only: false,
          requires_confirmation: true,
          policy: { destructive: true }
        }
      ],
      selectedMcpTool: "count",
      mcpCallResult: null,
      mcpError: null,
      loading: {
        boot: false,
        schema: false,
        chat: false,
        query: false,
        mcp: false
      }
    });
  });

  test("renders remote MCP server with tool schema and policy", () => {
    render(<McpPanel onRefresh={() => undefined} />);

    expect(screen.getByText("远程 MCP")).toBeInTheDocument();
    expect(screen.getByText("Agent 通过这个 endpoint 发现并调用本体工具。")).toBeInTheDocument();
    expect(screen.getByText("MCP Server")).toBeInTheDocument();
    expect(screen.getAllByText("http://127.0.0.1:8765/mcp").length).toBeGreaterThan(0);
    expect(screen.getByText("hv_access")).toBeInTheDocument();
    expect(screen.getByText("streamable-http")).toBeInTheDocument();
    expect(screen.getAllByText("count").length).toBeGreaterThan(0);
    expect(screen.getByText("mutate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "需确认 1" })).toBeInTheDocument();
    expect(screen.getByText("Input Schema")).toBeInTheDocument();
    expect(screen.getByText("Policy")).toBeInTheDocument();
  });

  test("calls the selected MCP tool with JSON arguments", async () => {
    render(<McpPanel onRefresh={() => undefined} />);

    const editors = screen.getAllByLabelText("json-editor");
    fireEvent.change(editors.at(-1)!, {
      target: { value: "{\"object_type\":\"Substation\"}" }
    });
    await userEvent.click(screen.getByRole("button", { name: "调用工具" }));

    expect(api.callMcpTool).toHaveBeenCalledWith("hv_access", "count", {
      object_type: "Substation"
    });
    expect(await screen.findByText(/"count": 3/)).toBeInTheDocument();
  });
});
