import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useConsoleStore } from "../../src/store/useConsoleStore";
import { ChatPanel } from "../../src/components/ChatPanel";

const originalCrypto = globalThis.crypto;
const originalEventSource = globalThis.EventSource;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  listeners = new Map<string, (event: MessageEvent) => void>();
  addEventListener = vi.fn((type: string, listener: EventListener) => {
    this.listeners.set(type, listener as (event: MessageEvent) => void);
  });
  close = vi.fn();

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

describe("ChatPanel", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    localStorage.clear();
    useConsoleStore.setState({
      currentDomain: null,
      ontology: { name: "test" },
      prompts: [],
      messages: [],
      traceEvents: [],
      pendingAction: null,
      loading: {
        boot: false,
        schema: false,
        chat: false,
        query: false
      }
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues(values: Uint8Array) {
          values.fill(1);
          return values;
        }
      }
    });
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: FakeEventSource
    });
  });

  afterEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto
    });
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: originalEventSource
    });
  });

  test("submits a message when crypto.randomUUID is unavailable", async () => {
    render(<ChatPanel />);

    await userEvent.type(screen.getByPlaceholderText("输入问题... 输入 / 查看示例"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(useConsoleStore.getState().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: "hello"
      })
    ]));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  test("renders enterprise chat workspace regions", () => {
    render(<ChatPanel />);

    expect(screen.getByText("Agent Workspace")).toBeInTheDocument();
    expect(screen.getByText("Assistant Panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prompts" })).toBeInTheDocument();
  });

  test("submits an empty-state prompt and shows processing feedback", async () => {
    useConsoleStore.setState({
      prompts: [{ group: "示例", prompt: "查一下G318公路有哪些路段？" }]
    });

    render(<ChatPanel />);

    await userEvent.click(screen.getByRole("button", { name: "查一下G318公路有哪些路段？ 示例" }));

    expect(useConsoleStore.getState().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "user",
        content: "查一下G318公路有哪些路段？"
      })
    ]));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("正在处理请求");
  });

  test("clears processing feedback when the stream sends done", async () => {
    render(<ChatPanel />);

    await userEvent.type(screen.getByPlaceholderText("输入问题... 输入 / 查看示例"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByRole("status")).toHaveTextContent("正在处理请求");

    act(() => {
      FakeEventSource.instances[0].emit("done", {});
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(useConsoleStore.getState().loading.chat).toBe(false);
  });

  test("prompt clicks can replace a running request", async () => {
    useConsoleStore.setState({
      prompts: [
        { group: "示例", prompt: "第一个问题" },
        { group: "示例", prompt: "第二个问题" }
      ]
    });

    render(<ChatPanel />);

    await userEvent.click(screen.getAllByRole("button", { name: "第一个问题" })[0]);
    await userEvent.click(screen.getByRole("button", { name: "第二个问题" }));

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
    expect(useConsoleStore.getState().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: "第一个问题" }),
      expect.objectContaining({ role: "user", content: "第二个问题" })
    ]));
  });

  test("renders tool messages as compact expandable cards", async () => {
    render(<ChatPanel />);
    act(() => {
      useConsoleStore.setState({
        messages: [{
          id: "tool",
          role: "tool",
          content: JSON.stringify([{ operator_id: "OP001", name: "张明" }]),
          createdAt: new Date().toISOString(),
          toolName: "get_operators_available",
          toolArgs: { event_id: "E002" }
        }]
      });
    });

    expect(screen.getByText("get_operators_available")).toBeInTheDocument();
    expect(screen.getByText("返回 1 条记录。")).toBeInTheDocument();
    expect(screen.queryByText(/operator_id/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "详情" }));

    expect(screen.getByText(/operator_id/)).toBeInTheDocument();
  });

  test("renders structured tool work before the assistant response inside a turn", () => {
    render(<ChatPanel />);
    act(() => {
      useConsoleStore.setState({
        messages: [
          {
            id: "user",
            role: "user",
            content: "查一下隧道",
            createdAt: new Date().toISOString(),
            turnId: "turn-1",
            phase: "request",
            sequence: 0
          },
          {
            id: "assistant",
            role: "assistant",
            content: "根据查询结果，龙门山隧道长度为 2800 米。",
            createdAt: new Date().toISOString(),
            turnId: "turn-1",
            phase: "response",
            sequence: 1
          },
          {
            id: "tool",
            role: "tool",
            content: JSON.stringify({ results: [{ tunnel_id: "T001" }] }),
            createdAt: new Date().toISOString(),
            turnId: "turn-1",
            phase: "work",
            sequence: 2,
            toolName: "query"
          }
        ]
      });
    });

    const tool = screen.getByText("query");
    const assistant = screen.getByText("根据查询结果，龙门山隧道长度为 2800 米。");

    expect(tool.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("preserves backend history order when messages do not include flow metadata", () => {
    render(<ChatPanel />);
    act(() => {
      useConsoleStore.setState({
        messages: [
          {
            id: "user",
            role: "user",
            content: "查一下隧道",
            createdAt: new Date().toISOString()
          },
          {
            id: "assistant",
            role: "assistant",
            content: "后端历史里的回复。",
            createdAt: new Date().toISOString()
          },
          {
            id: "tool",
            role: "tool",
            content: JSON.stringify({ results: [{ tunnel_id: "T001" }] }),
            createdAt: new Date().toISOString(),
            toolName: "query"
          }
        ]
      });
    });

    const assistant = screen.getByText("后端历史里的回复。");
    const tool = screen.getByText("query");

    expect(assistant.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("starts a new persisted session when new chat is clicked", async () => {
    useConsoleStore.setState({
      messages: [{
        id: "old",
        role: "user",
        content: "old message",
        createdAt: new Date().toISOString()
      }],
      traceEvents: [{
        id: "trace",
        tone: "turn",
        label: "Turn 1",
        createdAt: new Date().toISOString()
      }]
    });

    render(<ChatPanel />);
    const firstSession = localStorage.getItem("oag-session-root");

    await userEvent.click(screen.getByRole("button", { name: "新对话" }));

    expect(localStorage.getItem("oag-session-root")).not.toBe(firstSession);
    expect(useConsoleStore.getState().messages).toEqual([]);
    expect(useConsoleStore.getState().traceEvents).toEqual([]);
  });
});
