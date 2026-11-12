import { DEFAULT_AGENT_CONFIGS, normalizeAgentConfigs } from "./agents";
import type { AgentConfig } from "../types";

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
};

const STORAGE_KEY = "jarvis.settings.v2";

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const storedSessionId = str(parsed.sessionId, DEFAULT_SETTINGS.sessionId).trim();
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
      agentConfigs: normalizeAgentConfigs(parsed.agentConfigs),
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
