import { domainBase } from "./domain";
import type { DomainSummary, Ontology, QueryRow, StreamEvent } from "../types/oag";

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

  getRegistryFunctions(domain: string | null) {
    return requestJson<Record<string, unknown>>(`${domainBase(domain)}/schema/functions`);
  },

  queryObject(domain: string | null, objectType: string, limit = 25) {
    return requestJson<QueryRow[]>(`${domainBase(domain)}/query`, {
      method: "POST",
      body: JSON.stringify({ object_type: objectType, limit })
    });
  },

  callFunction(domain: string | null, name: string, args: Record<string, unknown>) {
    return requestJson<unknown>(`${domainBase(domain)}/function/${encodeURIComponent(name)}`, {
      method: "POST",
      body: JSON.stringify(args)
    });
  },

  getAudit(domain: string | null) {
    return requestJson<unknown[]>(`${domainBase(domain)}/audit`);
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
    const knownEvents = ["text", "tool_call", "confirmation", "question", "compact", "done"];
    for (const type of knownEvents) {
      es.addEventListener(type, (raw) => {
        const evt = raw as MessageEvent;
        try {
          onEvent(JSON.parse(evt.data) as StreamEvent);
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
