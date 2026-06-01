import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { ChatMessage, DomainSummary, Ontology, PendingAction, QueryRow, TraceEvent } from "../types/oag";

type ConsoleState = {
  domains: DomainSummary[];
  currentDomain: string | null;
  ontology: Ontology | null;
  registryFunctions: Record<string, unknown>;
  prompts: unknown[];
  selectedObject: string | null;
  selectedFunction: string | null;
  queryRows: QueryRow[];
  messages: ChatMessage[];
  traceEvents: TraceEvent[];
  pendingAction: PendingAction | null;
  loading: {
    boot: boolean;
    schema: boolean;
    chat: boolean;
    query: boolean;
  };
  setDomains: (domains: DomainSummary[]) => void;
  setCurrentDomain: (domain: string | null) => void;
  setOntology: (ontology: Ontology | null) => void;
  setRegistryFunctions: (functions: Record<string, unknown>) => void;
  setPrompts: (prompts: unknown[]) => void;
  setSelectedObject: (name: string | null) => void;
  setSelectedFunction: (name: string | null) => void;
  setQueryRows: (rows: QueryRow[]) => void;
  appendMessage: (message: ChatMessage) => void;
  appendAssistantText: (id: string, text: string) => void;
  replaceMessages: (messages: ChatMessage[]) => void;
  clearMessages: () => void;
  appendTraceEvent: (event: TraceEvent) => void;
  appendTraceDetail: (id: string, detail: string) => void;
  clearTraceEvents: () => void;
  setPendingAction: (action: PendingAction | null) => void;
  setLoading: (key: keyof ConsoleState["loading"], value: boolean) => void;
};

export const useConsoleStore = create<ConsoleState>()(
  immer((set) => ({
    domains: [],
    currentDomain: null,
    ontology: null,
    registryFunctions: {},
    prompts: [],
    selectedObject: null,
    selectedFunction: null,
    queryRows: [],
    messages: [],
    traceEvents: [],
    pendingAction: null,
    loading: {
      boot: true,
      schema: false,
      chat: false,
      query: false
    },
    setDomains: (domains) => set((state) => {
      state.domains = domains;
    }),
    setCurrentDomain: (domain) => set((state) => {
      state.currentDomain = domain;
    }),
    setOntology: (ontology) => set((state) => {
      state.ontology = ontology;
    }),
    setRegistryFunctions: (functions) => set((state) => {
      state.registryFunctions = functions;
    }),
    setPrompts: (prompts) => set((state) => {
      state.prompts = prompts;
    }),
    setSelectedObject: (name) => set((state) => {
      state.selectedObject = name;
    }),
    setSelectedFunction: (name) => set((state) => {
      state.selectedFunction = name;
    }),
    setQueryRows: (rows) => set((state) => {
      state.queryRows = rows;
    }),
    appendMessage: (message) => set((state) => {
      state.messages.push(message);
    }),
    appendAssistantText: (id, text) => set((state) => {
      const existing = state.messages.find((message) => message.id === id);
      if (existing) existing.content += text;
    }),
    replaceMessages: (messages) => set((state) => {
      state.messages = messages;
    }),
    clearMessages: () => set((state) => {
      state.messages = [];
    }),
    appendTraceEvent: (event) => set((state) => {
      state.traceEvents.push(event);
    }),
    appendTraceDetail: (id, detail) => set((state) => {
      const existing = state.traceEvents.find((event) => event.id === id);
      if (!existing) return;
      existing.detail = `${String(existing.detail ?? "")}${detail}`;
    }),
    clearTraceEvents: () => set((state) => {
      state.traceEvents = [];
    }),
    setPendingAction: (action) => set((state) => {
      state.pendingAction = action;
    }),
    setLoading: (key, value) => set((state) => {
      state.loading[key] = value;
    })
  }))
);
