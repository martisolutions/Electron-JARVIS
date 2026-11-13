export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error" | "connecting";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
};

export type AgentStatus = "idle" | "running" | "done" | "error";

export type AgentCard = {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  task?: string;
  startedAt?: number;
  endedAt?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  lastOperation?: string;
  summary?: string;
  transcriptPath?: string;
  delegationId?: string;
  model?: string;
};

export type AgentConfig = {
  id: string;
  name: string;
  role: string;
  trigger?: string;
  enabled: boolean;
  builtin?: boolean;
  primary?: boolean;
  instructions: string;
};

export type AgentLogEntry = {
  id: string;
  at: number;
  text: string;
};

export type ActivityKind = "think" | "message" | "tool" | "result" | "info" | "error";

export type AgentActivity = {
  id: string;
  at: number;
  agentId: string;
  kind: ActivityKind;
  text: string;
};

export type PanelKind = "code" | "diagram" | "text" | "markdown";

export type JarvisPanel = {
  id: string;
  title: string;
  kind: PanelKind;
  content: string;
  language?: string;
  createdAt: number;
  updatedAt: number;
  createdBy: "jarvis" | "user";
};

export type PanelState = {
  panels: JarvisPanel[];
  openIds: string[];
};
