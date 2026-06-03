import { domainBase } from "./domain";
import type { AgentToolsPayload, ChatMessage, DomainSummary, McpCallResult, McpStatus, McpTool, Ontology, StreamEvent } from "../types/oag";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listDomains() {
    return requestJson<DomainSummary[]>("/domains");
  },

  getPrompts(domain: string | null) {
    return requestJson<unknown[]>(`${domainBase(domain)}/prompts`);
  },

  getSchema(domain: string | null) {
    return requestJson<Ontology>(`${domainBase(domain)}/schema`);
  },

  getAudit(domain: string | null) {
    return requestJson<unknown[]>(`${domainBase(domain)}/audit`);
  },

  getMcpStatus(domain: string | null) {
    return requestJson<McpStatus>(`${domainBase(domain)}/mcp/status`);
  },

  getMcpTools(domain: string | null) {
    return requestJson<{ domain: string; tools: McpTool[] }>(`${domainBase(domain)}/mcp/tools`);
  },

  callMcpTool(domain: string | null, name: string, arguments_: Record<string, unknown>) {
    return requestJson<McpCallResult>(`${domainBase(domain)}/mcp/call`, {
      method: "POST",
      body: JSON.stringify({ name, arguments: arguments_ })
    });
  },

  getAgentTools(domain: string | null) {
    return requestJson<AgentToolsPayload>(`${domainBase(domain)}/agent/tools`);
  },

  getHistory(domain: string | null, sessionId: string) {
    return requestJson<Array<Pick<ChatMessage, "role" | "content">>>(`${domainBase(domain)}/agent/history?session_id=${encodeURIComponent(sessionId)}`);
  },

  confirm(domain: string | null, sessionId: string, approved: boolean, answer?: string) {
    return fetch(`${domainBase(domain)}/agent/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, approved, answer })
    });
  },

  streamChat(domain: string | null, message: string, sessionId: string, onEvent: (event: StreamEvent) => void) {
    const url = `${domainBase(domain)}/agent/chat/stream?message=${encodeURIComponent(message)}&session_id=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(url);
    const knownEvents = ["text", "tool_call", "debug", "reasoning", "compact", "confirmation_required", "question", "hook_blocked", "done"];
    for (const type of knownEvents) {
      es.addEventListener(type, (raw) => {
        const evt = raw as MessageEvent;
        try {
          const data = JSON.parse(evt.data) as Record<string, unknown>;
          onEvent({ ...data, type: String(data.type ?? type) } as StreamEvent);
        } catch {
          onEvent({ type, content: evt.data } as StreamEvent);
        }
        if (type === "done") es.close();
      });
    }
    es.onerror = () => {
      es.close();
      onEvent({ type: "error", message: "stream closed" });
    };
    return es;
  }
};

export function parseSseFrames(buffer: string, onEvent: (event: StreamEvent) => void) {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const remainder = frames.pop() ?? "";

  for (const frame of frames) {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (!dataLines.length) continue;
    try {
      const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
      onEvent({ type: String(data.type ?? eventName), ...data } as StreamEvent);
    } catch {
      onEvent({ type: eventName, content: dataLines.join("\n") } as StreamEvent);
    }
  }

  return remainder;
}
