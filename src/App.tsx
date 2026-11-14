import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AgentChatModal } from "./components/AgentChatModal";
import { Clock } from "./components/Clock";
import { AgentEditor } from "./components/AgentEditor";
import { Board } from "./components/Board";
import { CalendarScreen } from "./components/CalendarScreen";
import { LogsPanel } from "./components/LogsPanel";
import { NodeWords } from "./components/NodeWords";
import { Onboarding } from "./components/Onboarding";
import { SettingsPanel } from "./components/SettingsPanel";
import { AttachmentIcon, BoardIcon, CalendarIcon, LogsIcon, MicIcon, SendIcon, SettingsIcon, SparkIcon, StopIcon } from "./components/Icons";
import { AudioEngine } from "./lib/audio";
import { agentTargetForGoal, buildSystemPrompt, delegationAck } from "./lib/agents";
import { HermesClient, type RunEvent, type SessionMessage, type SessionRow } from "./lib/hermes";
import { VoiceRecorder } from "./lib/recorder";
import { errorMessage, friendlyError, sanitizeForSpeech } from "./lib/text";
import { HudOrb } from "./components/HudOrb";
import { HudLeftPanels, HudRightPanels, HudUptime } from "./components/HudPanels";
import { useStore } from "./store";
import type { AgentCard, BillingSnapshot, CalendarAlert, ConnectionState, NodeWord, OrbVisualState, SystemMetrics } from "./types";

type RecorderPhase = "idle" | "starting" | "recording" | "transcribing";
type RecordSource = "space" | "button";
type ButtonMode = "hold" | "latched";
type AppView = "jarvis" | "calendar" | "panels";

type NodeBridge = {
  listNodeWords?: () => Promise<{ words?: NodeWord[]; capacity?: number }>;
  addNodeWord?: (input: { word?: string; context?: string }) => Promise<NodeWord>;
  onNodeWords?: (callback: (state: { words?: NodeWord[]; capacity?: number }) => void) => () => void;
};

type FilesBridge = {
  jarvisDesktop?: {
    pickFiles?: () => Promise<string[]>;
  };
};

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: "EN ESPERA",
  connecting: "CONECTANDO",
  connected: "EN LÃƒÂNEA",
  error: "ERROR",
};

const MIN_RECORD_MS = 300;
const MAX_RECORD_MS = 60_000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function truncateText(value: string, max = 120): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}Ã¢â‚¬Â¦` : text;
}

function condenseReply(text: string, maxChars = 200): string {
  const value = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s,;)]+/g, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_>#~|]+/g, " ")
    .replace(/(\d)\.(\d)/g, "$1,$2")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";

  const sentences = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [value];
  let result = "";
  for (const sentence of sentences) {
    const next = `${result} ${sentence.trim()}`.trim();
    const sentenceCount = next.split(/(?<=[.!?])\s+/).filter(Boolean).length;
    if (sentenceCount > 2 || next.length > maxChars) break;
    result = next;
  }
  if (result) return result;

  const cut = value.slice(0, maxChars).trim();
  const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return lastStop > maxChars * 0.6 ? cut.slice(0, lastStop + 1) : `${cut}Ã¢â‚¬Â¦`;
}

function parseCostFromText(text: string): number | undefined {
  const json = text.match(/"cost_usd"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (json) return Number(json[1]);
  const dollar = text.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  return dollar ? Number(dollar[1]) : undefined;
}

function parseDurationFromText(text: string): number | undefined {
  const json = text.match(/"duration_seconds"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (json) return Number(json[1]);
  const duration = text.match(/(?:duration|duraci[oÃƒÂ³]n|tiempo)[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)\s*(?:s|seg|sec)?/i);
  return duration ? Number(duration[1]) : undefined;
}

function parseTokensFromText(text: string): { input?: number; output?: number } {
  const input = text.match(/"input_tokens"\s*:\s*([0-9]+)/i);
  const output = text.match(/"output_tokens"\s*:\s*([0-9]+)/i);
  return {
    input: input ? Number(input[1]) : undefined,
    output: output ? Number(output[1]) : undefined,
  };
}

function formatAsyncDelegation(content: string): string {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(content.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === "object") {
        const data = parsed as Record<string, unknown>;
        const taric = asString(data.taric_code) || asString(data.cn_code);
        const duty = asString(data.duty_rate);
        const extra = asString(data.additional_measures);
        const source = asString(data.source);

        if (taric || duty) {
          const parts: string[] = [];
          if (taric) parts.push(`TARIC ${taric}`);
          const cn = asString(data.cn_code);
          if (cn && cn !== taric) parts.push(`CN ${cn}`);
          const rate = duty.match(/[0-9]+(?:[.,][0-9]+)?\s*%/)?.[0];
          if (rate) parts.push(`derecho ${rate}`);
          const antidumping = extra.match(
            /(?:antidumping|antid[ÃƒÂºu]mping)[^0-9]{0,40}([0-9]+(?:[.,][0-9]+)?\s*%)/i,
          )?.[1];
          if (antidumping) parts.push(`antidumping ${antidumping}`);
          const sourceLabel = /ec\.europa\.eu/i.test(source) ? "TARIC (ComisiÃƒÂ³n Europea)" : "";
          const summary = parts.join("; ");
          return `${summary}${sourceLabel ? `. Fuente: ${sourceLabel}` : ""}.`;
        }

        const values = Object.values(data)
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .slice(0, 2);
        if (values.length > 0) {
          const summary = condenseReply(values.join(". "), 180);
          if (summary) return summary;
        }
      }
    } catch {
      /* plain text or several JSON blocks */
    }
  }

  const marker = /---[^\n]*\bTASK\b[^\n]*---[ \t]*\r?\n/i.exec(content);
  const from = marker ? marker.index + marker[0].length : 0;
  const transcript = content.indexOf("Full live transcript");
  const result = content
    .slice(from, transcript > from ? transcript : content.length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(dispatched|role|model|total duration|status):/i.test(line)) return false;
      if (/^\[TRUNCATED/i.test(line)) return false;
      return !/subagent hit its iteration cap|verify before relying|work may be incomplete/i.test(line);
    })
    .join(" ");
  const summary = condenseReply(result || content, 200) || "El subagente ha terminado.";
  return /TRUNCATED|hit max_iterations|iteration cap/i.test(content)
    ? `${summary} (incompleto: lÃƒÂ­mite de pasos)`
    : summary;
}

export default function App() {
  const settings = useStore((state) => state.settings);
  const connection = useStore((state) => state.connection);
  const connectionDetail = useStore((state) => state.connectionDetail);
  const orb = useStore((state) => state.orb);
  const messages = useStore((state) => state.messages);
  const partial = useStore((state) => state.partial);
  const settingsOpen = useStore((state) => state.settingsOpen);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);
  const agentChat = useStore((state) => state.agentChat);
  const agents = useStore((state) => state.agents);

  const audioRef = useRef<AudioEngine | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const hermesRef = useRef<HermesClient | null>(null);
  const partialRef = useRef("");
  const speechSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const sttAbortRef = useRef<AbortController | null>(null);
  const connectingRef = useRef(false);
  const noticeTimer = useRef<number | null>(null);

  const runIdRef = useRef<string | null>(null);
  const runStartRef = useRef(0);
  const runOutputRef = useRef("");
  const sessionCostBaselineRef = useRef(0);
  const sessionMessageBaselineRef = useRef(0);
  const lastSessionMessageIdRef = useRef(0);
  const sessionPollRef = useRef<number | null>(null);
  const sessionPollDeadlineRef = useRef(0);
  const pollBusyRef = useRef(false);
  const sessionWatchSeqRef = useRef(0);
  const notificationPollRef = useRef<number | null>(null);
  const notificationSeenRef = useRef(0);
  const activeDelegationRef = useRef<{
    id: string;
    name: string;
    role: string;
    startedAt: number;
    transcriptPath?: string;
    delegationId?: string;
  } | null>(null);
  const transcriptPathRef = useRef<string | null>(null);

  const phaseRef = useRef<RecorderPhase>("idle");
  const sourceRef = useRef<RecordSource | null>(null);
  const buttonModeRef = useRef<ButtonMode | null>(null);
  const pointerDownRef = useRef(false);
  const pointerStartRef = useRef(0);
  const pointerStopOnUpRef = useRef(false);
  const spaceDownRef = useRef(false);
  const maxTimerRef = useRef<number | null>(null);

  const [logsOpen, setLogsOpen] = useState(false);
  const [activeView, setActiveView] = useState<AppView>("jarvis");
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [billing, setBilling] = useState<BillingSnapshot | null>(null);
  const [nodeWords, setNodeWords] = useState<NodeWord[]>([]);
  const [nodeCapacity, setNodeCapacity] = useState(18);
  const [delegationPulse, setDelegationPulse] = useState(0);
  const [nodeZoom, setNodeZoom] = useState(1);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const attachmentsRef = useRef<string[]>([]);
  const [notice, setNotice] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingMode, setRecordingMode] = useState<ButtonMode | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  const micSupported = useMemo(() => {
    if (typeof navigator === "undefined" || typeof MediaRecorder === "undefined") return false;
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }, []);

  const connected = connection === "connected";
  const busy = orb === "thinking" || orb === "speaking";
  const anyRunning = Object.values(agents).some((agent) => agent.status === "running");
  const anySubagentRunning = Object.values(agents).some((agent) => agent.id !== "jarvis" && agent.status === "running");
  const orbVisualState: OrbVisualState = anySubagentRunning
    ? "delegated"
    : orb === "speaking"
      ? "talking"
      : orb === "thinking"
        ? "thinking"
        : "idle";
  const orbVisual = settings.orbStates[orbVisualState];
  const satelliteAgents = useMemo(() => {
    const list = Object.values(agents).filter((agent) => agent.id !== "jarvis" && agent.status === "running");
    const openAgent = agentChat ? agents[agentChat] : null;
    if (openAgent && openAgent.id !== "jarvis" && !list.some((agent) => agent.id === openAgent.id)) list.push(openAgent);
    return list.slice(0, 4).map((agent) => ({
      id: agent.id,
      name: agent.name,
      summary: (agent.summary || agent.lastOperation || agent.task || "recibiendo datos")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean)
        .slice(0, 10)
        .join(" "),
    }));  }, [agents, agentChat]);
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const lastMessage = messages[messages.length - 1];
  const awaitingReply = lastMessage?.role === "user";
  const caption = partial || (awaitingReply ? "" : (lastAssistant?.text ?? ""));
  const captionLabel = partial ? "JARVIS // TRANSMITIENDO" : "JARVIS";

  function notify(text: string): void {
    setNotice(text);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 8000);
  }

  function addSystem(text: string): void {
    useStore.getState().addMessage("system", text);
    notify(text);
  }

  useEffect(() => {
    partialRef.current = partial;
  }, [partial]);

  useEffect(() => {
    const bridge = (
      window as unknown as {
        jarvisDesktop?: {
          onPanelOpen?: (callback: () => void) => () => void;
          onAppView?: (callback: (view: AppView) => void) => () => void;
        };
      }
    ).jarvisDesktop;
    if (!bridge) return;
    const offPanel = bridge.onPanelOpen?.(() => setActiveView("panels"));
    const offView = bridge.onAppView?.((view) => {
      if (view === "calendar" || view === "panels" || view === "jarvis") setActiveView(view);
    });
    return () => {
      offPanel?.();
      offView?.();
    };
  }, []);

  useEffect(() => {
    const bridge = (
      window as unknown as { jarvisDesktop?: { onSecondInstance?: (callback: () => void) => () => void } }
    ).jarvisDesktop;
    if (!bridge?.onSecondInstance) return;

    return bridge.onSecondInstance(() => {
      const live = useStore.getState();
      live.setBoardOpen(false);
      if (live.agentChat) live.closeAgentChat();
      notify("Otra instancia de JARVIS detectada; comprobando agentes en segundo planoÃ¢â‚¬Â¦");
      if (live.connection === "connected") void resumeBackground();
      else void connect();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const bridge = (
      window as unknown as {
        jarvisDesktop?: { onReminder?: (callback: (reminder: { message?: string }) => void) => () => void };
      }
    ).jarvisDesktop;
    if (!bridge?.onReminder) return;

    return bridge.onReminder((reminder) => {
      const raw = typeof reminder?.message === "string" ? reminder.message.trim() : "";
      const display = condenseReply(raw, 220);
      if (!display) return;

      const store = useStore.getState();
      if (store.messages.slice(-6).some((entry) => entry.role === "assistant" && entry.text === display)) {
        return;
      }
      store.addMessage("assistant", display);
      if (!hermesRef.current) hermesRef.current = new HermesClient(store.settings);
      void audioRef.current?.ensure().catch(() => undefined);
      void speakText(display);
    });
  }, []);

  useEffect(() => {
    const audio = new AudioEngine();
    audioRef.current = audio;
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;

    return () => {
      audio.dispose();
      recorder.cancel();
      audioRef.current = null;
      recorderRef.current = null;
    };
  }, []);
  useEffect(() => {
    const seed = useStore.getState().settings;
    if (seed.onboarded && seed.hermesUrl.trim() && seed.hermesKey.trim()) void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const bridge = (window as unknown as { jarvisDesktop?: NodeBridge }).jarvisDesktop;
    if (!bridge?.listNodeWords && !bridge?.onNodeWords) return;
    let cancelled = false;
    void bridge.listNodeWords?.().then((state) => {
      if (!cancelled) {
        setNodeWords(Array.isArray(state?.words) ? state.words : []);
        setNodeCapacity(Number(state?.capacity) > 0 ? Number(state?.capacity) : 18);
      }
    });
    const unsubscribe = bridge.onNodeWords?.((state) => {
      if (!cancelled) {
        setNodeWords(Array.isArray(state?.words) ? state.words : []);
        setNodeCapacity(Number(state?.capacity) > 0 ? Number(state?.capacity) : 18);
      }
    });    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const bridge = (window as unknown as { jarvisDesktop?: { getBilling?: () => Promise<BillingSnapshot> } }).jarvisDesktop;
    if (!bridge?.getBilling) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const next = await bridge.getBilling?.();
        if (!cancelled && next) setBilling(next);
      } catch {
        /* billing is best-effort */
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const bridge = (window as unknown as { jarvisDesktop?: { getSystemMetrics?: () => Promise<SystemMetrics> } }).jarvisDesktop;
    if (!bridge?.getSystemMetrics) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const next = await bridge.getSystemMetrics?.();
        if (!cancelled && next) setMetrics(next);
      } catch {
        /* metrics are best-effort */
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const bridge = (window as unknown as {
      jarvisDesktop?: { onCalendarAlert?: (callback: (alert: CalendarAlert) => void) => () => void };
    }).jarvisDesktop;
    if (!bridge?.onCalendarAlert) return;
    return bridge.onCalendarAlert((alert) => {
      const message = typeof alert?.message === "string" ? alert.message.trim() : "";
      if (!message) return;
      const store = useStore.getState();
      store.addMessage("assistant", message);
      if (!hermesRef.current) hermesRef.current = new HermesClient(store.settings);
      void audioRef.current?.ensure().catch(() => undefined);
      void speakText(message);
    });
  }, []);
  useEffect(() => {
    if (sessionStorage.getItem("jarvis.welcomePlayed") === "1") return;
    const audio = audioRef.current;
    if (!audio) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/audio/jarvis-inicializado.mp3", { cache: "force-cache" });
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        sessionStorage.setItem("jarvis.welcomePlayed", "1");
        useStore.getState().setOrb("speaking");
        await audio.play(bytes);
        if (!cancelled && useStore.getState().orb === "speaking") useStore.getState().setOrb("idle");
      } catch {
        if (!cancelled && useStore.getState().orb === "speaking") useStore.getState().setOrb("idle");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const isEditable = (node: EventTarget | null): boolean => {
      const element = node instanceof Element ? node : null;
      if (!element) return false;
      return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
        return;
      }
      if (useStore.getState().settingsOpen) return;
      const ui = useStore.getState();
      if (ui.boardOpen || ui.agentChat) return;
      if (isEditable(event.target) || isEditable(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      if (spaceDownRef.current) return;
      spaceDownRef.current = true;
      if (phaseRef.current === "idle") void startRecording("space");
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (!spaceDownRef.current) return;
      spaceDownRef.current = false;
      event.preventDefault();
      if (sourceRef.current === "space" && phaseRef.current === "recording") {
        void finishRecording("space");
      }
    };

    const onBlur = () => {
      spaceDownRef.current = false;
      pointerDownRef.current = false;
      if (phaseRef.current === "starting") {
        cancelRecording();
      } else if (phaseRef.current === "recording") {
        void finishRecording(sourceRef.current ?? "space", true);
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const ui = useStore.getState();
      if (ui.boardOpen || ui.agentChat) return;
      stopAll();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onEscape);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onEscape);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (window as unknown as { __jarvisDebug?: unknown }).__jarvisDebug = {
      messages: () => useStore.getState().messages,
      orb: () => useStore.getState().orb,
      phase: () => phaseRef.current,
      agents: () => useStore.getState().agents,
      agentLog: () => useStore.getState().agentLog,
    };
    return () => {
      delete (window as unknown as { __jarvisDebug?: unknown }).__jarvisDebug;
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      sttAbortRef.current?.abort();
      stopSessionWatch();
      stopNotificationPoll();
      if (maxTimerRef.current !== null) window.clearTimeout(maxTimerRef.current);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(): Promise<void> {
    if (connectingRef.current) return;
    connectingRef.current = true;

    const live = useStore.getState();
    const current = live.settings;
    const client = new HermesClient(current);
    hermesRef.current = client;
    live.setConnection("connecting", "Consultando JARVISÃ¢â‚¬Â¦");
    if (useStore.getState().orb !== "speaking") live.setOrb("connecting");

    try {
      const models = await client.listModels();
      const selected = models.includes(current.model) ? current.model : (models[0] ?? "hermes-agent");
      if (selected !== current.model) {
        live.setSettings({ model: selected });
        hermesRef.current = new HermesClient({ ...current, model: selected });
      }

      live.setConnection("connected", `${selected} Ã‚Â· ${hostOf(current.hermesUrl)}`);
      if (useStore.getState().orb !== "speaking") live.setOrb("idle");
      void audioRef.current?.ensure().catch(() => undefined);
      await initializeSessionBaseline();
      void resumeBackground();
      startNotificationPoll();

      if (new URLSearchParams(window.location.search).has("testvoice")) {
        window.setTimeout(() => void speakText("Hola Jordi. Soy JARVIS. Sistemas en lÃƒÂ­nea."), 700);
      }
    } catch (error) {
      live.setConnection("error", friendlyError(errorMessage(error)));
      live.setOrb("error");
    } finally {
      connectingRef.current = false;
    }
  }

  async function initializeSessionBaseline(): Promise<void> {
    const client = hermesRef.current;
    if (!client) return;

    try {
      const sessionId = useStore.getState().settings.sessionId || "jarvis-core";
      const messages = await client.getSessionMessages(sessionId, 100);
      const maxId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
      sessionMessageBaselineRef.current = Math.max(sessionMessageBaselineRef.current, maxId);
      lastSessionMessageIdRef.current = Math.max(lastSessionMessageIdRef.current, maxId);
      notificationSeenRef.current = Math.max(notificationSeenRef.current, maxId);
    } catch {
      /* the first run can still establish its own baseline */
    }
  }

  async function resumeBackground(): Promise<void> {
    const client = hermesRef.current;
    if (!client) return;

    try {
      const status = await client.getGatewayStatus();
      if (!status || (status.activeRuns <= 0 && status.activeDelegations <= 0)) return;

      const sessionId = useStore.getState().settings.sessionId;
      const messages = await client.getSessionMessages(sessionId, 100);
      const latestDelegation = [...messages]
        .reverse()
        .find(
          (message) =>
            typeof message.content === "string" && /"live_transcripts"\s*:/.test(message.content),
        );

      if (!latestDelegation) {
        notify("Hay una ejecuciÃƒÂ³n en curso, pero no encuentro un subagente recuperable en esta sesiÃƒÂ³n.");
        return;
      }

      const maxId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
      sessionMessageBaselineRef.current = maxId;
      lastSessionMessageIdRef.current = maxId;
      parseDelegationMessage(latestDelegation.content ?? "", latestDelegation);
      await startSessionWatch();
      const live = useStore.getState();
      live.patchAgent("jarvis", {
        status: "idle",
        lastOperation: "Agentes en segundo plano",
      });
      live.logAgent("JARVIS Ã¢â€ â€™ sesiÃƒÂ³n: recuperando agentes en segundo plano");
      notify("Ejecuciones en segundo plano detectadas; sesiÃƒÂ³n recuperada.");
    } catch {
      /* best effort: the normal connection remains usable */
    }
  }

  function disconnect(): void {
    stopAll();
    stopNotificationPoll();
    speechSeq.current += 1;
    audioRef.current?.stop();
    const live = useStore.getState();
    live.setConnection("idle");
    live.setOrb("idle");
    live.setPartial("");
    partialRef.current = "";
  }

  function resetRecordingState(): void {
    phaseRef.current = "idle";
    sourceRef.current = null;
    buttonModeRef.current = null;
    pointerStopOnUpRef.current = false;
    setRecording(false);
    setRecordingMode(null);
    setTranscribing(false);
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    const live = useStore.getState();
    if (live.orb === "listening" || live.orb === "thinking") live.setOrb("idle");
  }

  async function startRecording(source: RecordSource): Promise<void> {
    if (phaseRef.current !== "idle") return;
    const live = useStore.getState();
    if (live.connection !== "connected") {
      notify("Conecta JARVIS para hablar.");
      return;
    }
    if (!live.settings.elevenLabsKey.trim()) {
      notify("Falta la API key de ElevenLabs. AÃƒÂ±ÃƒÂ¡dela en Ajustes para dictar.");
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder) return;

    phaseRef.current = "starting";
    sourceRef.current = source;
    buttonModeRef.current = null;
    setRecording(false);
    setRecordingMode(null);
    setTranscribing(false);

    speechSeq.current += 1;
    audioRef.current?.stop();
    abortRef.current?.abort();
    abortRef.current = null;
    sttAbortRef.current?.abort();
    sttAbortRef.current = null;
    partialRef.current = "";
    live.setPartial("");

    try {
      await recorder.start();

      if (phaseRef.current !== "starting") {
        recorder.cancel();
        return;
      }

      phaseRef.current = "recording";
      setRecording(true);
      useStore.getState().setOrb("listening");

      if (source === "space" && !spaceDownRef.current) {
        void finishRecording("space");
        return;
      }

      if (source === "button" && !pointerDownRef.current) {
        const held = performance.now() - pointerStartRef.current;
        if (held < MIN_RECORD_MS) {
          buttonModeRef.current = "latched";
          setRecordingMode("latched");
        } else {
          void finishRecording("button");
          return;
        }
      }

      maxTimerRef.current = window.setTimeout(() => {
        void finishRecording(source, true);
      }, MAX_RECORD_MS);
    } catch (error) {
      phaseRef.current = "idle";
      setRecording(false);
      setRecordingMode(null);
      setTranscribing(false);
      useStore.getState().setOrb("idle");
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        notify(errorMessage(error));
      }
    }
  }

  async function finishRecording(source: RecordSource, auto = false): Promise<void> {
    if (phaseRef.current !== "recording") return;
    if (!auto && sourceRef.current !== source) return;

    phaseRef.current = "transcribing";
    setRecording(false);
    setRecordingMode(null);
    setTranscribing(true);
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }

    const live = useStore.getState();
    live.setOrb("thinking");
    const recorder = recorderRef.current;
    if (!recorder) {
      resetRecordingState();
      return;
    }
    const duration = recorder.durationMs;

    try {
      const blob = await recorder.stop();

      if (phaseRef.current !== "transcribing") return;

      if (blob.size === 0 || duration < 250) {
        notify(source === "space" ? "MantÃƒÂ©n espacio un poco mÃƒÂ¡s para hablar." : "MantÃƒÂ©n pulsado un poco mÃƒÂ¡s para hablar.");
        resetRecordingState();
        return;
      }

      const client = new HermesClient(useStore.getState().settings);
      const controller = new AbortController();
      sttAbortRef.current = controller;
      const text = await client.transcribe(blob, controller.signal);
      sttAbortRef.current = null;

      if (controller.signal.aborted) {
        resetRecordingState();
        return;
      }

      if (!text) {
        notify("No se detectÃƒÂ³ voz. IntÃƒÂ©ntalo de nuevo.");
        resetRecordingState();
        return;
      }

      resetRecordingState();
      await sendMessage(text);
    } catch (error) {
      sttAbortRef.current = null;
      if (error instanceof DOMException && error.name === "AbortError") {
        resetRecordingState();
        return;
      }
      resetRecordingState();
      notify(friendlyError(errorMessage(error)));
    }
  }

  function cancelRecording(): void {
    if (phaseRef.current === "idle" || phaseRef.current === "transcribing") return;
    phaseRef.current = "idle";
    recorderRef.current?.cancel();
    resetRecordingState();
  }

  function stopAll(): void {
    abortRef.current?.abort();
    abortRef.current = null;
    const runId = runIdRef.current;
    runIdRef.current = null;
    if (runId) void hermesRef.current?.stopRun(runId);
    stopSessionWatch();
    activeDelegationRef.current = null;
    transcriptPathRef.current = null;
    speechSeq.current += 1;
    audioRef.current?.stop();
    sttAbortRef.current?.abort();
    sttAbortRef.current = null;

    if (phaseRef.current === "recording" || phaseRef.current === "starting") {
      recorderRef.current?.cancel();
    }
    if (phaseRef.current !== "idle") resetRecordingState();

    partialRef.current = "";
    const live = useStore.getState();
    live.setPartial("");
    live.setOrb("idle");
    for (const agent of Object.values(live.agents)) {
      live.patchAgent(agent.id, { status: "idle", task: undefined, lastOperation: undefined });
    }
  }

  async function stopEverything(): Promise<void> {
    if (!window.confirm("Ã¯Â¿Â½Detener todas las ejecuciones de JARVIS y sus agentes? Se reiniciarÃ¯Â¿Â½ el cerebro local.")) {
      return;
    }

    stopAll();
    stopNotificationPoll();
    const live = useStore.getState();
    for (const agent of Object.values(live.agents)) {
      live.patchAgent(agent.id, {
        status: "idle",
        lastOperation: "Detenido por Jordi",
        endedAt: Date.now(),
      });
    }
    live.logAgent("Jordi detuvo todas las ejecuciones.");
    notify("Deteniendo todos los agentesÃ¢â‚¬Â¦");

    const bridge = (window as unknown as { jarvisDesktop?: { stopAllAgents?: () => Promise<boolean> } })
      .jarvisDesktop;
    let stopped = false;
    try {
      stopped = (await bridge?.stopAllAgents?.()) ?? false;
    } catch {
      stopped = false;
    }

    notify(stopped ? "Agentes detenidos. ReconectandoÃ¢â‚¬Â¦" : "No se pudo confirmar el reinicio de Hermes. ReconectandoÃ¢â‚¬Â¦");
    window.setTimeout(() => {
      void connect();
    }, 800);
  }

  function extractNodeWord(text: string): string {
    const stopwords = new Set([
      "para", "como", "cuando", "donde", "desde", "hasta", "sobre", "entre", "porque", "quiero",
      "puedes", "podrias", "hacer", "hazme", "dime", "dame", "ayuda", "necesito", "tengo", "hola",
      "gracias", "esto", "esta", "este", "esos", "esas", "algo", "algun", "alguna", "todo", "toda",
      "the", "and", "for", "with", "that", "this", "from", "what", "when", "where", "how", "can",
      "you", "please", "help", "need", "have", "about", "into", "your", "my", "me", "we", "it",
    ]);
    const tokens = text.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
    const candidates = tokens.filter((token) => token.length >= 3 && !stopwords.has(token));
    return (candidates.sort((left, right) => right.length - left.length)[0] ?? "consulta").slice(0, 48);
  }

  async function rememberNodeWord(text: string): Promise<void> {
    const question = text.replace(/\s+/g, " ").trim();
    if (!question) return;
    const payload = { word: extractNodeWord(question), context: question.slice(0, 280) };
    const bridge = (window as unknown as { jarvisDesktop?: NodeBridge }).jarvisDesktop;
    try {
      if (bridge?.addNodeWord) await bridge.addNodeWord(payload);
      else {
        await fetch("http://127.0.0.1:5191/nodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    } catch {
      /* the visual node is best-effort */
    }
  }

  async function sendMessage(raw: string): Promise<void> {
    let text = raw.trim();
    const files = attachmentsRef.current;
    if (!text && files.length === 0) return;

    const client = hermesRef.current;
    const live = useStore.getState();
    if (!client || live.connection !== "connected") {
      addSystem("Conecta JARVIS primero.");
      return;
    }

    void rememberNodeWord(text || (files.length > 0 ? "archivos adjuntos" : ""));
    if (files.length > 0) {
      text = `${text || "Analiza los archivos adjuntos."}\n\nArchivos adjuntos:\n${files
        .map((file) => `- ${file}`)
        .join("\n")}`;
      attachmentsRef.current = [];
      setAttachments([]);
    }
    if (!text) return;

    void audioRef.current?.ensure().catch(() => undefined);
    speechSeq.current += 1;
    audioRef.current?.stop();
    abortRef.current?.abort();
    abortRef.current = null;
    stopSessionWatch();

    activeDelegationRef.current = null;
    transcriptPathRef.current = null;
    sessionMessageBaselineRef.current = lastSessionMessageIdRef.current;
    sessionCostBaselineRef.current = 0;
    runOutputRef.current = "";
    partialRef.current = "";
    runStartRef.current = Date.now();
    runIdRef.current = null;

    live.setPartial("");
    live.addMessage("user", text);
    live.resetAgents(text);
    live.setOrb("thinking");

    const sessionId = live.settings.sessionId || "jarvis-voice";

    try {
      const baselineSession = await client.getSession(sessionId);
      sessionCostBaselineRef.current =
        typeof baselineSession?.estimated_cost_usd === "number" ? baselineSession.estimated_cost_usd : 0;
      const baselineMessages = await client.getSessionMessages(sessionId, 30);
      const maxBaseline = baselineMessages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
      sessionMessageBaselineRef.current = maxBaseline;
      lastSessionMessageIdRef.current = maxBaseline;
    } catch {
      /* the run can proceed without a cost baseline */
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const runId = await client.startRun(text, sessionId, buildSystemPrompt(useStore.getState().settings.agentConfigs));
      runIdRef.current = runId;
      await client.streamRun(runId, handleRunEvent, controller.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const latest = useStore.getState();
      latest.setPartial("");
      partialRef.current = "";
      latest.setOrb("error");
      latest.patchAgent("jarvis", { status: "error", endedAt: Date.now(), lastOperation: "Error de conexiÃƒÂ³n" });
      addSystem(friendlyError(errorMessage(error)));
      window.setTimeout(() => {
        if (useStore.getState().orb === "error") useStore.getState().setOrb("idle");
      }, 2600);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function startDelegation(goal: string, startedAt: number): void {
    const store = useStore.getState();
    const target = agentTargetForGoal(goal, useStore.getState().settings.agentConfigs);
    const previous = activeDelegationRef.current;
    const start = previous?.id === target.id ? Math.min(previous.startedAt, startedAt) : startedAt;
    const task = goal.replace(/^\d+\s+tasks?:\s*/i, "").trim() || goal;

    activeDelegationRef.current = {
      ...target,
      startedAt: start,
      delegationId: previous?.delegationId,
      transcriptPath: previous?.transcriptPath,
    };
    store.patchAgent(target.id, {
      name: target.name,
      role: target.role,
      status: "running",
      task,
      startedAt: start,
      endedAt: undefined,
      costUsd: undefined,
      lastOperation: "Iniciando subagenteÃ¢â‚¬Â¦",
    });
    if (!previous || previous.id !== target.id) {
      store.logAgent(`JARVIS Ã¢â€ â€™ ${target.name}: ${truncateText(task, 90)}`);
    }
  }

  function finalizeRun(event: RunEvent): void {
    const store = useStore.getState();
    const original = asString(event.output) || partialRef.current.trim();
    runOutputRef.current = original;
    const active = activeDelegationRef.current;
    const output = active ? delegationAck(active) : condenseReply(original);
    runIdRef.current = null;
    partialRef.current = "";
    store.setPartial("");

    const usage = (event.usage ?? {}) as Record<string, unknown>;
    const inputTokens = asNumber(usage.input_tokens);
    const outputTokens = asNumber(usage.output_tokens);
    const provisional =
      inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) * 0.0000003 + (outputTokens ?? 0) * 0.0000012
        : undefined;

    store.patchAgent("jarvis", {
      status: "done",
      endedAt: Date.now(),
      inputTokens,
      outputTokens,
      costUsd: provisional,
      lastOperation: output ? "Respuesta entregada" : "Sin respuesta",
    });

    if (output) {
      store.addMessage("assistant", output);
      if (store.settings.autoSpeak) void speakText(output);
      else store.setOrb("idle");
    } else {
      store.setOrb("idle");
    }

    void startSessionWatch();
  }

  function handleRunEvent(event: RunEvent): void {
    const store = useStore.getState();

    switch (event.event) {
      case "message.delta": {
        const delta = asString(event.delta);
        if (delta) {
          partialRef.current += delta;
          store.setPartial(partialRef.current);
          store.setOrb("thinking");
        }
        break;
      }
      case "reasoning.available": {
        const thought = asString(event.text);
        if (thought) {
          store.logActivity("jarvis", "think", thought);
          store.patchAgent("jarvis", { lastOperation: `Razonamiento: ${truncateText(thought, 80)}` });
        }
        break;
      }
      case "message.interim": {
        const interim = asString(event.text);
        if (interim) store.logActivity("jarvis", "message", interim);
        break;
      }
      case "tool.started": {
        const tool = asString(event.tool);
        const preview = asString(event.preview);
        store.patchAgent("jarvis", {
          status: "running",
          lastOperation: preview ? `${tool} Ã‚Â· ${truncateText(preview, 80)}` : tool,
        });
        store.logActivity("jarvis", "tool", preview ? `${tool}: ${preview}` : tool);
        if (tool === "delegate_task") startDelegation(preview, Date.now());
        break;
      }
      case "tool.completed": {
        const tool = asString(event.tool);
        const failed = event.error === true;
        const preview = asString(event.preview);
        store.patchAgent("jarvis", { lastOperation: failed ? `${tool} Ã‚Â· error` : `${tool} Ã‚Â· completado` });
        store.logActivity("jarvis", failed ? "error" : "result", preview ? `${tool}: ${preview}` : tool);
        if (tool === "delegate_task") {
          const active = activeDelegationRef.current;
          if (active) store.patchAgent(active.id, { lastOperation: "Delegado Ã¢â€Â¬Ãƒâ‚¬ en segundo plano" });
        }
        break;
      }
      case "subagent.start": {
        const goal = asString(event.goal) || asString(event.preview);
        const target = agentTargetForGoal(goal, useStore.getState().settings.agentConfigs);
        const startedAt = Date.now();
        activeDelegationRef.current = {
          ...target,
          startedAt,
          delegationId: asString(event.delegation_id) || undefined,
        };
        store.patchAgent(target.id, {
          name: target.name,
          role: target.role,
          status: "running",
          task: goal,
          startedAt,
          lastOperation: "Subagente iniciado",
        });
        store.logActivity(target.id, "info", goal);
        store.logAgent(`JARVIS Ãƒâ€ÃƒÂ¥Ãƒâ€  ${target.name}: ${truncateText(goal, 90)}`);
        break;
      }
      case "subagent.complete": {
        const goal = asString(event.goal) || activeDelegationRef.current?.name || "Subagente";
        const target = agentTargetForGoal(goal, useStore.getState().settings.agentConfigs);
        const status = asString(event.status);
        store.patchAgent(target.id, {
          status: status === "completed" ? "done" : "error",
          endedAt: Date.now(),
          costUsd: asNumber(event.cost_usd),
          inputTokens: asNumber(event.input_tokens),
          outputTokens: asNumber(event.output_tokens),
          summary: asString(event.summary) || asString(event.output_tail),
          lastOperation: status || "Completado",
        });
        store.logAgent(
          `${target.name} Ãƒâ€ÃƒÂ¥Ãƒâ€  JARVIS: ${truncateText(asString(event.summary) || asString(event.output_tail) || "completado", 90)}`,
        );
        store.logActivity(target.id, status === "completed" ? "info" : "error", asString(event.summary) || asString(event.output_tail) || status || "completado");
        setDelegationPulse((value) => value + 1);
        void fetchChildSessionCost(asString(event.child_session_id) || asString(event.subagent_session_id));
        break;
      }
      case "run.completed": {
        finalizeRun(event);
        break;
      }
      case "run.failed":
      case "run.error":
      case "run.cancelled":
      case "run.interrupted": {
        const message = asString(event.error) || event.event;
        partialRef.current = "";
        runIdRef.current = null;
        store.setPartial("");
        store.setOrb("idle");
        store.patchAgent("jarvis", { status: "error", endedAt: Date.now(), lastOperation: truncateText(message, 80) });
        store.logActivity("jarvis", "error", message);
        notify(friendlyError(message));
        break;
      }
      default:
        break;
    }
  }

  function stopSessionWatch(): void {
    sessionWatchSeqRef.current += 1;
    if (sessionPollRef.current !== null) {
      window.clearInterval(sessionPollRef.current);
      sessionPollRef.current = null;
    }
    pollBusyRef.current = false;
  }

  function stopNotificationPoll(): void {
    if (notificationPollRef.current !== null) {
      window.clearInterval(notificationPollRef.current);
      notificationPollRef.current = null;
    }
  }

  function startNotificationPoll(): void {
    stopNotificationPoll();
    notificationSeenRef.current = Math.max(notificationSeenRef.current, lastSessionMessageIdRef.current);
    notificationPollRef.current = window.setInterval(() => {
      void pollNotifications();
    }, 10_000);
  }

  async function pollNotifications(): Promise<void> {
    const client = hermesRef.current;
    if (!client) return;
    const ui = useStore.getState();
    if (ui.connection !== "connected" || ui.orb === "thinking" || ui.orb === "speaking") return;
    if (runIdRef.current || activeDelegationRef.current || sessionPollRef.current !== null) return;

    const sessionId = ui.settings.sessionId || "jarvis-core";
    try {
      const messages = await client.getSessionMessages(sessionId, 20);
      const maxId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
      if (maxId <= notificationSeenRef.current) return;

      const seen = notificationSeenRef.current;
      for (const message of messages) {
        const id = Number(message.id) || 0;
        if (id <= seen) continue;
        if (message.role !== "assistant" && message.role !== "system") continue;
        const content = typeof message.content === "string" ? message.content.trim() : "";
        if (!content) continue;
        if (message.role === "system" && content.startsWith("{")) continue;
        if (content.startsWith("[ASYNC DELEGATION")) continue;
        const display = condenseReply(content, 220);
        if (!display) continue;

        const store = useStore.getState();
        if (store.messages.slice(-40).some((entry) => entry.role === "assistant" && entry.text === display)) {
          continue;
        }
        store.addMessage("assistant", display);
        if (store.settings.autoSpeak) void speakText(display);
        else store.setOrb("idle");
      }
      notificationSeenRef.current = maxId;
    } catch {
      /* transient local API failure; retry on the next tick */
    }
  }

  function applySessionCost(session: SessionRow | null): void {
    if (!session || typeof session.estimated_cost_usd !== "number") return;
    const delta = Math.max(0, session.estimated_cost_usd - sessionCostBaselineRef.current);
    const store = useStore.getState();
    store.patchAgent("jarvis", { costUsd: delta });

    const active = activeDelegationRef.current;
    if (!active) return;
    const card = store.agents[active.id];
    if (card?.status === "running" || card?.costUsd === undefined) {
      store.patchAgent(active.id, { costUsd: delta });
    }
  }

  async function startSessionWatch(): Promise<void> {
    const client = hermesRef.current;
    if (!client) return;
    const sessionId = useStore.getState().settings.sessionId || "jarvis-core";
    stopSessionWatch();
    const generation = sessionWatchSeqRef.current;

    try {
      const messages = await client.getSessionMessages(sessionId, 30);
      if (generation !== sessionWatchSeqRef.current) return;
      const maxId = messages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0);
      lastSessionMessageIdRef.current = Math.max(lastSessionMessageIdRef.current, sessionMessageBaselineRef.current, maxId);

      for (const message of messages) {
        if (generation !== sessionWatchSeqRef.current) return;
        if ((Number(message.id) || 0) <= sessionMessageBaselineRef.current) continue;
        handleSessionMessage(message, false);
      }

      const session = await client.getSession(sessionId);
      if (generation !== sessionWatchSeqRef.current) return;
      applySessionCost(session);
    } catch {
      /* the watch can still try on its interval */
    }

    if (generation !== sessionWatchSeqRef.current) return;
    sessionPollDeadlineRef.current =
      Date.now() + (activeDelegationRef.current ? 15 * 60_000 : 25_000);
    sessionPollRef.current = window.setInterval(() => {
      void pollSession(generation);
    }, 1500);
  }

  async function pollSession(generation: number): Promise<void> {
    if (pollBusyRef.current || generation !== sessionWatchSeqRef.current) return;
    pollBusyRef.current = true;

    const client = hermesRef.current;
    const sessionId = useStore.getState().settings.sessionId || "jarvis-core";
    try {
      if (!client || generation !== sessionWatchSeqRef.current) {
        if (!client) stopSessionWatch();
        return;
      }

      const session = await client.getSession(sessionId);
      if (generation !== sessionWatchSeqRef.current) return;
      applySessionCost(session);

      const messages = await client.getSessionMessages(sessionId, 40);
      if (generation !== sessionWatchSeqRef.current) return;
      for (const message of messages) {
        if (generation !== sessionWatchSeqRef.current) return;
        const id = Number(message.id) || 0;
        if (id <= lastSessionMessageIdRef.current) continue;
        lastSessionMessageIdRef.current = id;
        handleSessionMessage(message, true);
      }

      if (generation !== sessionWatchSeqRef.current) return;
      const active = activeDelegationRef.current;
      if (active?.transcriptPath) await readTranscript(active);
      if (generation !== sessionWatchSeqRef.current) return;

      if (!active) {
        if (Date.now() > sessionPollDeadlineRef.current) stopSessionWatch();
        return;
      }

      if (activeDelegationRef.current) {
        sessionPollDeadlineRef.current = Math.max(sessionPollDeadlineRef.current, Date.now() + 60_000);
      }

      const card = useStore.getState().agents[active.id];
      if (card?.status === "done" && Date.now() > (card.endedAt ?? 0) + 15_000) {
        stopSessionWatch();
      }
      if (Date.now() > sessionPollDeadlineRef.current) {
        useStore.getState().patchAgent(active.id, {
          status: "error",
          endedAt: Date.now(),
          lastOperation: "Tiempo de espera agotado",
        });
        stopSessionWatch();
      }
    } catch {
      /* transient session read failure; the interval retries */
    } finally {
      pollBusyRef.current = false;
    }
  }

  function extractChildSessionId(text: string): string | undefined {
    return text.match(/"(?:child_session_id|subagent_session_id)"\s*:\s*"([^"]+)"/i)?.[1];
  }

  async function fetchChildSessionCost(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    const active = activeDelegationRef.current;
    const client = hermesRef.current;
    if (!active || !client) return;

    try {
      const session = await client.getSession(sessionId);
      if (!session) return;
      const patch: Partial<AgentCard> = {};
      const cost = asNumber(session.estimated_cost_usd);
      const input = asNumber(session.input_tokens);
      const output = asNumber(session.output_tokens);
      const started = asNumber(session.started_at);
      const ended = asNumber(session.ended_at);
      if (cost !== undefined) patch.costUsd = cost;
      if (input !== undefined) patch.inputTokens = input;
      if (output !== undefined) patch.outputTokens = output;
      if (started !== undefined) patch.startedAt = started * 1000;
      if (ended !== undefined) patch.endedAt = ended * 1000;
      if (Object.keys(patch).length > 0) useStore.getState().patchAgent(active.id, patch);
    } catch {
      /* the child session may be hidden from the API */
    }
  }

  function handleSessionMessage(message: SessionMessage, addToChat: boolean): void {
    const store = useStore.getState();
    const content = typeof message.content === "string" ? message.content.trim() : "";
    const toolName = typeof message.tool_name === "string" ? message.tool_name : "";

    void fetchChildSessionCost(extractChildSessionId(content));

    if (message.role === "user" && /^\[ASYNC DELEGATION BATCH COMPLETE/i.test(content)) {
      handleAsyncDelegation(content, addToChat);
      return;
    }

    if (toolName === "delegate_task" || /"live_transcripts"\s*:/.test(content)) {
      parseDelegationMessage(content, message);
      return;
    }

    if (!addToChat) return;
    if (message.role !== "assistant" && message.role !== "system") return;
    if (!content) return;
    if (message.role === "system" && content.startsWith("{")) return;
    if (content === runOutputRef.current) return;

    const reply = condenseReply(content);
    if (!reply) return;
    if (store.messages.slice(-6).some((entry) => entry.role === "assistant" && entry.text === reply)) return;

    const active = activeDelegationRef.current;
    if (active) {
      const card = store.agents[active.id];
      if (card?.status === "running") {
        const duration = parseDurationFromText(content);
        const cost = parseCostFromText(content);
        const tokens = parseTokensFromText(content);
        store.patchAgent(active.id, {
          status: "done",
          endedAt: Date.now(),
          ...(cost !== undefined ? { costUsd: cost } : {}),
          ...(duration !== undefined ? { startedAt: Date.now() - duration * 1000 } : {}),
          ...(tokens.input !== undefined ? { inputTokens: tokens.input } : {}),
          ...(tokens.output !== undefined ? { outputTokens: tokens.output } : {}),
          summary: truncateText(reply, 320),
          lastOperation: "Resultado recibido",
        });
      }
      store.logAgent(`${active.name} Ã¢â€ â€™ JARVIS: ${truncateText(reply, 90)}`);
    }

    store.addMessage("assistant", reply);
    if (store.settings.autoSpeak) void speakText(reply);
    else store.setOrb("idle");
  }

  function handleAsyncDelegation(content: string, addToChat: boolean): void {
    const display = condenseReply(formatAsyncDelegation(content), 220);
    const store = useStore.getState();
    const active = activeDelegationRef.current;
    const completionId = /^\[ASYNC DELEGATION BATCH COMPLETE\s*[-Ã¢â‚¬â€]\s*([^\]]+)\]/i.exec(content)?.[1]?.trim();
    if (!active) return;
    if (completionId && active.delegationId && completionId !== active.delegationId) return;
    const duration = Number(/Total duration:\s*([0-9]+(?:\.[0-9]+)?)\s*s/i.exec(content)?.[1]);
    const now = Date.now();

    if (active) {
      const card = store.agents[active.id];
      if (card?.status !== "done") {
        store.patchAgent(active.id, {
          status: "done",
          endedAt: now,
          ...(Number.isFinite(duration) ? { startedAt: now - duration * 1000 } : {}),
          lastOperation: "Resultado recibido",
          summary: truncateText(display, 320),
        });
      }
      store.logAgent(`${active.name} Ã¢â€ â€™ JARVIS: ${truncateText(display, 90)}`);
    }

    if (!addToChat || !display) return;

    if (store.messages.slice(-6).some((entry) => entry.role === "assistant" && entry.text === display)) return;
    store.addMessage("assistant", display);
    if (store.settings.autoSpeak) void speakText(display);
    else store.setOrb("idle");
  }

  function parseDelegationMessage(content: string, message: SessionMessage): void {
    let data: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(content) as unknown;
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (!data) return;

    const goals = Array.isArray(data.goals)
      ? data.goals.filter((goal): goal is string => typeof goal === "string")
      : [];
    const transcripts = Array.isArray(data.live_transcripts)
      ? data.live_transcripts.filter((path): path is string => typeof path === "string")
      : [];
    if (goals.length === 0 && transcripts.length === 0) return;

    const timestamp = Number(message.timestamp) * 1000;
    if (!activeDelegationRef.current && timestamp && timestamp < runStartRef.current - 60_000) {
      return;
    }

    const goal = goals[0] ?? "Subagente";
    const target = agentTargetForGoal(goal, useStore.getState().settings.agentConfigs);
    const startedAt = activeDelegationRef.current?.startedAt ?? (timestamp || Date.now());
    const delegationId = asString(data.delegation_id);
    const transcriptPath = transcripts[0];

    activeDelegationRef.current = { ...target, startedAt, delegationId, transcriptPath };
    transcriptPathRef.current = transcriptPath ?? null;
    sessionPollDeadlineRef.current = Math.max(sessionPollDeadlineRef.current, Date.now() + 15 * 60_000);

    const store = useStore.getState();
    const existing = store.agents[target.id];
    store.patchAgent(target.id, {
      name: target.name,
      role: target.role,
      status: "running",
      task: goal,
      startedAt,
      transcriptPath,
      delegationId,
    });
    if (!existing || existing.status !== "running") {
      store.logAgent(`JARVIS Ã¢â€ â€™ ${target.name}: ${truncateText(goal, 90)}`);
    }
  }

  async function readTranscript(active: { id: string; transcriptPath?: string }): Promise<void> {
    if (!active.transcriptPath) return;
    const bridge = (window as unknown as { jarvisDesktop?: { readHermesLog?: (path: string) => Promise<string> } })
      .jarvisDesktop;
    if (!bridge?.readHermesLog) return;

    try {
      const text = await bridge.readHermesLog(active.transcriptPath);
      if (!text) return;
      if (useStore.getState().agents[active.id]?.status !== "running") return;
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const last = [...lines].reverse().find((line) => /^\d{1,2}:\d{2}:\d{2}\s+[a-z]+\s*\|/i.test(line));
      if (!last) return;
      const clean = last.replace(/^\d{1,2}:\d{2}:\d{2}\s+[a-z]+\s*\|\s*/i, "").trim();
      if (clean) useStore.getState().patchAgent(active.id, { lastOperation: truncateText(clean, 100) });
    } catch {
      /* transcript may rotate or be unavailable */
    }
  }

  async function speakText(text: string): Promise<void> {
    const client = hermesRef.current;
    const audio = audioRef.current;
    if (!client || !audio) return;

    const speech = sanitizeForSpeech(text);
    if (!speech) {
      useStore.getState().setOrb("idle");
      return;
    }

    const seq = ++speechSeq.current;
    useStore.getState().setOrb("thinking");

    try {
      const { bytes } = await client.speak(speech);
      if (seq !== speechSeq.current) return;
      useStore.getState().setOrb("speaking");
      await audio.play(bytes);
      if (seq === speechSeq.current && useStore.getState().orb === "speaking") {
        useStore.getState().setOrb("idle");
      }
    } catch (error) {
      if (seq !== speechSeq.current) return;
      useStore.getState().setOrb("idle");
      addSystem(friendlyError(errorMessage(error)));
    }
  }

  function handleMicPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0 || transcribing) return;
    event.preventDefault();
    pointerDownRef.current = true;
    pointerStartRef.current = performance.now();
    pointerStopOnUpRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* synthetic pointers may not support capture */
    }

    if (phaseRef.current === "recording" && sourceRef.current === "button" && buttonModeRef.current === "latched") {
      pointerStopOnUpRef.current = true;
      return;
    }

    if (phaseRef.current === "idle") void startRecording("button");
  }

  function handleMicPointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    pointerDownRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }

    if (sourceRef.current !== "button") return;
    if (phaseRef.current === "starting") return;
    if (phaseRef.current !== "recording") return;

    if (pointerStopOnUpRef.current) {
      pointerStopOnUpRef.current = false;
      void finishRecording("button");
      return;
    }

    if (buttonModeRef.current === "latched") {
      void finishRecording("button");
      return;
    }

    const held = performance.now() - pointerStartRef.current;
    if (held < MIN_RECORD_MS) {
      buttonModeRef.current = "latched";
      setRecordingMode("latched");
      return;
    }

    void finishRecording("button");
  }

  function handleMicPointerCancel(): void {
    pointerDownRef.current = false;
    pointerStopOnUpRef.current = false;
    if (sourceRef.current === "button" && (phaseRef.current === "recording" || phaseRef.current === "starting")) {
      cancelRecording();
    }
  }

  function setAttachmentList(next: string[]): void {
    attachmentsRef.current = next;
    setAttachments(next);
  }

  async function pickAttachments(): Promise<void> {
    const bridge = (window as unknown as FilesBridge).jarvisDesktop;
    if (!bridge?.pickFiles) {
      notify("Los archivos adjuntos solo estÃƒÂ¡n disponibles en la app de escritorio.");
      return;
    }
    try {
      const picked = await bridge.pickFiles();
      if (picked.length === 0) return;
      setAttachmentList([...new Set([...attachmentsRef.current, ...picked])]);
    } catch {
      notify("No se pudieron adjuntar los archivos.");
    }
  }

  function removeAttachment(filePath: string): void {
    setAttachmentList(attachmentsRef.current.filter((path) => path !== filePath));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    const text = input;
    setInput("");
    void sendMessage(text);
  }

  function testVoice(): void {
    hermesRef.current = new HermesClient(useStore.getState().settings);
    void audioRef.current?.ensure().catch(() => undefined);
    void speakText("Hola Jordi. Soy JARVIS. Sistemas en lÃƒÂ­nea. Todos los sistemas funcionan correctamente.");
  }

  const micTitle = !micSupported
    ? "MicrÃƒÂ³fono no disponible"
    : transcribing
      ? "TranscribiendoÃ¢â‚¬Â¦"
      : recording
        ? recordingMode === "latched"
          ? "Grabando: clic para parar"
          : "Grabando: suelta para enviar"
        : "MantÃƒÂ©n para hablar";

  return (
    <div className="app hud-app" data-state={orb} data-view={activeView}>
      <header className="hud-header">
        <div className="hud-brand">
          <span>J.A.R.V.I.S.</span>
          <small>NEXUS CORE // SYSTEM MONITOR</small>
        </div>
        <Clock />
        <div className="hud-header-right">
          <span className={`status status-${connection}`} title={connectionDetail}>
            <i />
            {STATUS_LABEL[connection]}
          </span>
          <span className="hud-uptime-wrap">
            <i /> ONLINE Â· T+<HudUptime metrics={metrics} />
          </span>
          <button
            type="button"
            className={`icon-btn stop-everything ${anyRunning || busy ? "is-active" : ""}`}
            onClick={() => void stopEverything()}
            aria-label="Detener todos los agentes"
            title="Detener todos los agentes"
          >
            <StopIcon />
          </button>
          <button type="button" className="icon-btn logs-btn" onClick={() => setLogsOpen(true)} aria-label="Logs de agentes" title="Logs de agentes">
            <LogsIcon />
          </button>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Ajustes" title="Ajustes">
            <SettingsIcon />
          </button>
        </div>
      </header>

      <nav className="hud-view-nav" aria-label="Vistas principales">
        <button type="button" className={activeView === "calendar" ? "view-tab is-active" : "view-tab"} onClick={() => setActiveView("calendar")} aria-current={activeView === "calendar" ? "page" : undefined}>
          <CalendarIcon />
          <span>CALENDARIO</span>
        </button>
        <button type="button" className={activeView === "jarvis" ? "view-tab view-tab-core is-active" : "view-tab view-tab-core"} onClick={() => setActiveView("jarvis")} aria-current={activeView === "jarvis" ? "page" : undefined}>
          <SparkIcon size={22} />
          <span>JARVIS</span>
          <small>CORE</small>
        </button>
        <button type="button" className={activeView === "panels" ? "view-tab is-active" : "view-tab"} onClick={() => setActiveView("panels")} aria-current={activeView === "panels" ? "page" : undefined}>
          <BoardIcon />
          <span>PANELES</span>
        </button>
      </nav>

      <main className="hud-main">
        {activeView === "jarvis" ? <HudLeftPanels metrics={metrics} /> : null}
        {activeView === "calendar" ? <CalendarScreen /> : null}
        {activeView === "panels" ? <Board embedded onClose={() => setActiveView("jarvis")} /> : null}
        <section className="hud-stage" aria-live="polite">
          <HudOrb load={metrics?.cpu ?? 0} mode={orbVisualState} visual={orbVisual} level={() => audioRef.current?.getLevels().level ?? 0} satellites={satelliteAgents} delegationPulse={delegationPulse} onZoom={setNodeZoom} />
          <NodeWords words={nodeWords} zoom={nodeZoom} capacity={nodeCapacity} mode={orbVisualState} color={orbVisual.color} />
          <div className="hud-core-caption">CORE STABLE Â· {metrics ? metrics.freq.toFixed(2) : "â€”"} GHZ</div>
          {caption ? (
            <div className="hud-caption">
              <span>{captionLabel}</span>
              <p>{caption}</p>
            </div>
          ) : null}
          {notice ? <div className="hud-notice">{notice}</div> : null}
        </section>
        {activeView === "jarvis" ? <HudRightPanels metrics={metrics} billing={billing} /> : null}
      </main>

      {logsOpen ? <LogsPanel onClose={() => setLogsOpen(false)} /> : null}
      {agentChat ? <AgentChatModal /> : null}
      <AgentEditor />
      {!settings.onboarded ? <Onboarding onComplete={() => void connect()} /> : null}

      <footer className="dock hud-dock">
        {recording || transcribing ? (
          <div className={`recording-pill ${transcribing ? "is-transcribing" : ""}`} role="status">
            <i />
            {transcribing
              ? "TRANSCRIBIENDOÃ¢â‚¬Â¦"
              : recordingMode === "latched"
                ? "GRABANDO Ã‚Â· CLIC PARA PARAR"
                : "GRABANDO Ã‚Â· SUELTA PARA ENVIAR"}
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="attachment-row">
            {attachments.map((filePath) => (
              <span className="attachment-chip" key={filePath} title={filePath}>
                <span>{fileNameFromPath(filePath)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(filePath)}
                  aria-label={`Quitar ${fileNameFromPath(filePath)}`}
                >
                  Ãƒâ€”
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="voice-controls">
          <button
            type="button"
            className={`round-btn mic ${recording ? "is-active" : ""}`}
            onPointerDown={handleMicPointerDown}
            onPointerUp={handleMicPointerUp}
            onPointerCancel={handleMicPointerCancel}
            onClick={(event) => event.preventDefault()}
            disabled={!connected || !micSupported || transcribing}
            aria-label={micTitle}
            aria-pressed={recording}
            title={micTitle}
          >
            <MicIcon />
          </button>
          <button
            type="button"
            className="round-btn clip"
            onClick={() => void pickAttachments()}
            disabled={!connected}
            aria-label="Adjuntar archivos"
            title="Adjuntar archivos"
          >
            <AttachmentIcon />
          </button>
        </div>

        <form className="composer" onSubmit={handleSubmit}>
          <input
            className="composer-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={connected ? "Habla con JARVIS..." : "Conecta JARVIS para empezar"}
            disabled={!connected}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
          />

          {busy ? (
            <button type="button" className="round-btn send stop" onClick={stopAll} aria-label="Detener">
              <StopIcon />
            </button>
          ) : (
            <button
              type="submit"
              className="round-btn send"
              disabled={!connected || (!input.trim() && attachments.length === 0) || recording || transcribing}
              aria-label="Enviar"
            >
              <SendIcon />
            </button>
          )}
        </form>

        <div className="meta-row">
          <span>{settings.elevenLabsKey ? "VOZ Ã‚Â· ELEVENLABS" : "VOZ Ã‚Â· SIN KEY"}</span>
          <span>JARVIS Ã‚Â· CORE</span>
          <span className="hint">ESPACIO MANTENER PARA HABLAR Ã‚Â· ESC CANCELAR</span>
        </div>
      </footer>

      {settings.onboarded && !connected && !settingsOpen ? (
        <div className="gate">
          <div className="gate-inner">
            <div className="gate-ring" aria-hidden="true" />
            <span className="eyebrow">INTERFAZ DE VOZ</span>
            <h1>J.A.R.V.I.S.</h1>
            <p>
              {connection === "connecting"
                ? "Estableciendo enlace con JARVISÃ¢â‚¬Â¦"
                : connection === "error"
                  ? connectionDetail || "No se pudo conectar con JARVIS."
                  : "Un orbe vivo para JARVIS. Voz, texto y audio en tiempo real."}
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => void connect()}
              disabled={connection === "connecting"}
            >
              {connection === "connecting" ? "ConectandoÃ¢â‚¬Â¦" : "Conectar a JARVIS"}
            </button>
            <button type="button" className="ghost" onClick={() => setSettingsOpen(true)}>
              Configurar JARVIS y voz
            </button>
            <small className="gate-hint">
              Hermes local: <code>http://127.0.0.1:8643/v1</code>
            </small>
            {!micSupported ? <small>MicrÃƒÂ³fono no disponible; el chat de texto sÃƒÂ­ funciona.</small> : null}
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <SettingsPanel
          connection={connection}
          onConnect={() => void connect()}
          onDisconnect={disconnect}
          onTestVoice={testVoice}
        />
      ) : null}
    </div>
  );
}

