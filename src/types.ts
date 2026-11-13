export type ConnectionState = "idle" | "connecting" | "connected" | "error";

export type OrbState = "idle" | "listening" | "thinking" | "speaking" | "error" | "connecting";

export type BillingSnapshot = {
  at: number;
  elevenLabs: {
    used: number;
    limit: number;
    remaining: number;
    percent: number;
    resetUnix: number;
    tier: string;
  } | null;
  deepseek: {
    currency: string;
    total: number;
    granted: number;
    toppedUp: number;
    spent: number;
    available: boolean;
  } | null;
};
export type OrbVisualState = "idle" | "thinking" | "talking" | "delegated";

export type OrbVisualConfig = {
  color: string;
  expansion: number;
};
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

export type NodeWord = {
  id: string;
  word: string;
  context: string;
  at: number;
};

export type NodeWordsState = {
  words: NodeWord[];
};
export type SystemMetrics = {
  cpu: number;
  cores: number[];
  freq: number;
  ramUsed: number;
  ramTotal: number;
  ramCache: number;
  vramUsed: number;
  vramTotal: number;
  gpuTemp: number;
  gpuLoad: number;
  gpuName: string;
  diskRead: number;
  diskWrite: number;
  uptime: number;
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
