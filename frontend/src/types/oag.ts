export type DomainSummary = {
  name: string;
  description?: string;
};

export type PropertyDef = {
  type?: string;
  required?: boolean;
  description?: string;
  default?: unknown;
};

export type ObjectTypeDef = {
  kind?: string;
  description?: string;
  summary?: string;
  properties?: Record<string, PropertyDef>;
  status_transitions?: Record<string, string[]>;
  excluded_functions?: string[];
  constraints?: Array<{
    when?: Record<string, unknown>;
    excluded_functions?: string[];
    reason?: string;
  }>;
  data_source?: string;
  mutability?: string;
};

export type LinkDef = {
  source: string;
  target: string;
  join?: Record<string, string>;
  description?: string;
  link_type?: string;
  cardinality?: string;
};

export type FunctionParam = {
  type?: string;
  description?: string;
  default?: unknown;
};

export type FunctionDef = {
  description?: string;
  summary?: string;
  group?: string;
  depends_on?: string[];
  hint?: string;
  params?: Record<string, FunctionParam>;
  function_type?: string;
  writes_to?: string[];
  involves_objects?: string[];
  preconditions?: Array<Record<string, unknown>>;
  effects?: Array<Record<string, unknown>>;
  temporal_constraints?: Array<Record<string, unknown>>;
};

export type RuleDef = {
  description?: string;
  rule_type?: string;
  applies_to?: string[];
  conditions?: Array<Record<string, unknown>>;
  result_field?: string;
  source?: string;
};

export type WorkflowStep = {
  name: string;
  function?: string;
  description?: string;
  next?: string | Record<string, string>;
  sla?: string;
};

export type WorkflowDef = {
  description?: string;
  trigger?: string;
  steps?: WorkflowStep[];
  involves_objects?: string[];
};

export type Ontology = {
  name: string;
  description?: string;
  objects?: Record<string, ObjectTypeDef>;
  links?: Record<string, LinkDef>;
  functions?: Record<string, FunctionDef>;
  rules?: Record<string, RuleDef>;
  workflows?: Record<string, WorkflowDef>;
};

export type ChatRole = "user" | "assistant" | "system" | "tool";
export type ChatPhase = "request" | "work" | "notice" | "response";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  turnId?: string;
  phase?: ChatPhase;
  sequence?: number;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: string;
};

export type TraceTone =
  | "turn"
  | "tool-call"
  | "tool-result"
  | "text"
  | "debug-request"
  | "debug-response"
  | "reasoning"
  | "planner"
  | "executor"
  | "reviewer"
  | "synth"
  | "error";

export type TraceEvent = {
  id: string;
  tone: TraceTone;
  label: string;
  detail?: unknown;
  createdAt: string;
};

export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_call"; name: string; args?: unknown; result?: string }
  | { type: "confirmation_required"; tool_name: string; args?: unknown; reason?: string }
  | { type: "question"; question: string; options?: Array<{ label: string; description?: string }>; multi_select?: boolean }
  | { type: "debug"; stage?: string; content?: string }
  | { type: "reasoning"; content?: string }
  | { type: "compact" }
  | { type: "hook_blocked"; hook_event?: string; reason?: string }
  | { type: "done" }
  | Record<string, unknown>;

export type PendingAction = {
  kind: "confirmation" | "question";
  sessionId: string;
  title: string;
  detail?: string;
  options?: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
};

export type GraphNode = {
  id: string;
  label: string;
  kind: string;
  summary?: string;
  description?: string;
  value: number;
  color: string;
};

export type GraphLink = {
  id?: string;
  source: string;
  target: string;
  label: string;
  type?: string;
};

export type QueryRow = Record<string, unknown>;

export type McpStatusValue = "online" | "offline" | "loading" | "error";

export type McpStatus = {
  status: McpStatusValue;
  domain?: string | null;
  endpoint?: string;
  transport?: string;
  tool_count: number;
  read_only_count: number;
  write_count: number;
  requires_confirmation_count: number;
  error?: string;
};

export type McpTool = {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  category?: string;
  read_only?: boolean;
  requires_confirmation?: boolean;
  policy?: Record<string, unknown>;
};

export type McpCallResult = {
  domain: string;
  name: string;
  result: unknown;
  raw: string;
};

export type SessionInfo = {
  session_id: string;
  updated_at: string;
  preview: string;
};

export type AgentTool = {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  category?: string;
  read_only?: boolean;
  requires_confirmation?: boolean;
  policy?: Record<string, unknown>;
};

export type AgentToolsPayload = {
  agent_tools: AgentTool[];
  mcp_tool_count: number;
};
