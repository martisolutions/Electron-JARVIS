import { create } from "zustand";
import { agentCardsFromConfigs, normalizeAgentConfigs } from "./lib/agents";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import type { AgentCard, AgentConfig, AgentLogEntry, ChatMessage, ConnectionState, OrbState } from "./types";

type Store = {
  settings: Settings;
  connection: ConnectionState;
  connectionDetail: string;
  orb: OrbState;
  messages: ChatMessage[];
  partial: string;
  settingsOpen: boolean;
  boardOpen: boolean;
  agentChat: string | null;
  agentEditor: string | "manage" | null;
  agents: Record<string, AgentCard>;
  agentLog: AgentLogEntry[];
  setSettings: (patch: Partial<Settings>) => void;
  setConnection: (connection: ConnectionState, detail?: string) => void;
  setOrb: (orb: OrbState) => void;
  addMessage: (role: ChatMessage["role"], text: string) => void;
  setPartial: (partial: string) => void;
  setSettingsOpen: (open: boolean) => void;
  setBoardOpen: (open: boolean) => void;
  openAgentChat: (agentId: string) => void;
  closeAgentChat: () => void;
  openAgentEditor: (agentId: string | null) => void;
  closeAgentEditor: () => void;
  saveAgentConfigs: (configs: AgentConfig[]) => void;
  clearConversation: () => void;
  resetAgents: (task: string) => void;
  patchAgent: (id: string, patch: Partial<AgentCard>) => void;
  logAgent: (text: string) => void;
};

let messageSeq = 0;
let logSeq = 0;

function newMessage(role: ChatMessage["role"], text: string): ChatMessage {
  messageSeq += 1;
  return { id: `m${Date.now()}-${messageSeq}`, role, text, at: Date.now() };
}

const initialSettings = loadSettings();

export const useStore = create<Store>((set, get) => ({
  settings: initialSettings,
  connection: "idle",
  connectionDetail: "",
  orb: "idle",
  messages: [],
  partial: "",
  settingsOpen: false,
  boardOpen: false,
  agentChat: null,
  agentEditor: null,
  agents: agentCardsFromConfigs(initialSettings.agentConfigs),
  agentLog: [],

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    set({ settings: next });
  },

  setConnection: (connection, detail = "") => set({ connection, connectionDetail: detail }),

  setOrb: (orb) => set({ orb }),

  addMessage: (role, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({ messages: [...state.messages, newMessage(role, trimmed)].slice(-40) }));
  },

  setPartial: (partial) => set({ partial }),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  setBoardOpen: (boardOpen) => set({ boardOpen }),

  openAgentChat: (agentChat) => set({ agentChat }),

  closeAgentChat: () => set({ agentChat: null }),

  openAgentEditor: (agentId: string | null) => set({ agentEditor: agentId ?? "manage" }),

  closeAgentEditor: () => set({ agentEditor: null }),

  saveAgentConfigs: (configs) => {
    const normalized = normalizeAgentConfigs(configs);
    const settings = { ...get().settings, agentConfigs: normalized };
    saveSettings(settings);
    set({
      settings,
      agents: agentCardsFromConfigs(normalized, get().agents),
    });
  },

  clearConversation: () => set({ messages: [], partial: "" }),

  resetAgents: (task) => {
    const agents = agentCardsFromConfigs(get().settings.agentConfigs);
    const primary = agents.jarvis ?? { id: "jarvis", name: "JARVIS", role: "Principal", status: "idle" as const };
    agents.jarvis = {
      ...primary,
      status: "running",
      task,
      startedAt: Date.now(),
      endedAt: undefined,
      costUsd: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
      lastOperation: "Preparando respuesta…",
    };
    set({ agents, agentLog: [] });
  },

  patchAgent: (id, patch) => {
    set((state) => {
      const current = state.agents[id] ?? { id, name: id, role: "Subagente", status: "idle" as const };
      return { agents: { ...state.agents, [id]: { ...current, ...patch } } };
    });
  },

  logAgent: (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    logSeq += 1;
    const entry: AgentLogEntry = { id: `l${Date.now()}-${logSeq}`, at: Date.now(), text: trimmed };
    set((state) => ({ agentLog: [...state.agentLog, entry].slice(-14) }));
  },
}));
