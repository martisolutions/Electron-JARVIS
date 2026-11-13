import { DEFAULT_AGENT_CONFIGS, normalizeAgentConfigs } from "./agents";
import type { AgentConfig, OrbVisualConfig, OrbVisualState } from "../types";

export type Settings = {
  hermesUrl: string;
  hermesKey: string;
  model: string;
  sessionId: string;
  elevenLabsKey: string;
  voiceId: string;
  elevenLabsModel: string;
  autoSpeak: boolean;
  onboarded: boolean;
  agentConfigs: AgentConfig[];
  orbStates: Record<OrbVisualState, OrbVisualConfig>;
};

export const DEFAULT_SETTINGS: Settings = {
  hermesUrl: "http://127.0.0.1:8643/v1",
  hermesKey: "",
  model: "hermes-agent",
  sessionId: "jarvis-core",
  elevenLabsKey: "",
  voiceId: "bk9pYhUWGgt4Nf0ivB3g",
  elevenLabsModel: "eleven_multilingual_v2",
  autoSpeak: true,
  onboarded: false,
  agentConfigs: DEFAULT_AGENT_CONFIGS.map((agent) => ({ ...agent })),
  orbStates: {
    idle: { color: "#ff9a1f", expansion: 1 },
    thinking: { color: "#b47cff", expansion: 1.28 },
    talking: { color: "#4fe3ff", expansion: 1.12 },
    delegated: { color: "#ff4f7a", expansion: 1.22 },
  },
};

const STORAGE_KEY = "jarvis.settings.v2";

function normalizeOrbStates(value: unknown): Record<OrbVisualState, OrbVisualConfig> {
  const fallback = DEFAULT_SETTINGS.orbStates;
  if (!value || typeof value !== "object") return { ...fallback };
  const source = value as Partial<Record<OrbVisualState, Partial<OrbVisualConfig>>>;
  const result = {} as Record<OrbVisualState, OrbVisualConfig>;
  for (const key of Object.keys(fallback) as OrbVisualState[]) {
    const entry = source[key];
    const color = typeof entry?.color === "string" && /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : fallback[key].color;
    const expansion = typeof entry?.expansion === "number" ? Math.max(0.7, Math.min(1.8, entry.expansion)) : fallback[key].expansion;
    result[key] = { color, expansion };
  }
  return result;
}
function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const storedSessionId = str(parsed.sessionId, DEFAULT_SETTINGS.sessionId).trim();
    const agentConfigs = normalizeAgentConfigs(parsed.agentConfigs);
    const visionDefault = DEFAULT_AGENT_CONFIGS.find((agent) => agent.id === "vision");
    if (visionDefault) {
      for (const agent of agentConfigs) {
        if (
          agent.id === "vision" &&
          agent.builtin &&
          /navegador Chrome visible|Solo VISI[^ ]+ abre Google Chrome/i.test(agent.instructions)
        ) {
          agent.instructions = visionDefault.instructions;
          agent.role = visionDefault.role;
        }
      }
    }
    return {
      hermesUrl: str(parsed.hermesUrl, DEFAULT_SETTINGS.hermesUrl).trim() || DEFAULT_SETTINGS.hermesUrl,
      hermesKey: str(parsed.hermesKey, DEFAULT_SETTINGS.hermesKey),
      model: str(parsed.model, DEFAULT_SETTINGS.model).trim() || DEFAULT_SETTINGS.model,
      sessionId:
        storedSessionId === "jarvis-voice" ||
        storedSessionId === "jarvis-main" ||
        storedSessionId === "jarvis-main-2" ||
        !storedSessionId
          ? DEFAULT_SETTINGS.sessionId
          : storedSessionId,
      elevenLabsKey: str(parsed.elevenLabsKey, DEFAULT_SETTINGS.elevenLabsKey),
      voiceId: str(parsed.voiceId, DEFAULT_SETTINGS.voiceId).trim() || DEFAULT_SETTINGS.voiceId,
      elevenLabsModel: str(parsed.elevenLabsModel, DEFAULT_SETTINGS.elevenLabsModel).trim() || DEFAULT_SETTINGS.elevenLabsModel,
      autoSpeak: typeof parsed.autoSpeak === "boolean" ? parsed.autoSpeak : DEFAULT_SETTINGS.autoSpeak,
      onboarded:
        typeof parsed.onboarded === "boolean"
          ? parsed.onboarded
          : Boolean(str(parsed.hermesKey, "").trim()),
      agentConfigs,
      orbStates: normalizeOrbStates(parsed.orbStates),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable */
  }
}
