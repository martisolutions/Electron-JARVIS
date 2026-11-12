import type { Settings } from "./settings";

export type HermesMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatDeltaHandler = (delta: string) => void;

export class HermesError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "HermesError";
    this.status = status;
  }
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export class HermesClient {
  private readonly settings: Settings;
  private readonly baseUrl: string;

  constructor(settings: Settings) {
    this.settings = settings;
    this.baseUrl = normalizeBase(settings.hermesUrl);
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.settings.hermesKey.trim()) headers.Authorization = `Bearer ${this.settings.hermesKey.trim()}`;
    return headers;
  }

  async listModels(): Promise<string[]> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    } catch {
      throw new HermesError(
        "No se pudo conectar con JARVIS. Verifica que Hermes local esté activo en http://127.0.0.1:8643/v1.",
      );
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new HermesError(
        response.status === 401
          ? "La API key de JARVIS (Hermes) no es válida (API_SERVER_KEY)."
          : `JARVIS respondió ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => null)) as { data?: Array<{ id?: unknown }> } | null;
    const ids = (payload?.data ?? [])
      .map((row) => (typeof row?.id === "string" ? row.id : ""))
      .filter((id) => id.length > 0);

    return ids.length > 0 ? ids : ["hermes-agent"];
  }

  async chatStream(
    messages: HermesMessage[],
    onDelta: ChatDeltaHandler,
    signal?: AbortSignal,
  ): Promise<string> {
    const body = JSON.stringify({
      model: this.settings.model.trim() || "hermes-agent",
      messages,
      stream: true,
    });

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body,
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new HermesError(
        "No se pudo conectar con JARVIS. Verifica que Hermes local esté activo en http://127.0.0.1:8643/v1.",
      );
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new HermesError(
        response.status === 401
          ? "La API key de JARVIS (Hermes) no es válida (API_SERVER_KEY)."
          : `JARVIS respondió ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/event-stream") || !response.body) {
      const payload = (await response.json().catch(() => null)) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      } | null;
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content === "string" && content.length > 0) {
        onDelta(content);
        return content;
      }
      throw new HermesError("JARVIS devolvió una respuesta vacía.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        for (const line of chunk.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
            };
            const delta = event.choices?.[0]?.delta?.content ?? event.choices?.[0]?.message?.content;
            if (typeof delta === "string" && delta.length > 0) {
              full += delta;
              onDelta(delta);
            }
          } catch {
            /* ignore malformed keepalive/data lines */
          }
        }
      }
    }

    return full;
  }

  async speak(text: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const apiKey = this.settings.elevenLabsKey.trim();
    if (!apiKey) {
      throw new HermesError("Falta la API key de ElevenLabs. Añádela en Ajustes para activar la voz.");
    }

    const voiceId = this.settings.voiceId.trim() || "bk9pYhUWGgt4Nf0ivB3g";
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: this.settings.elevenLabsModel.trim() || "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true,
          },
        }),
      });
    } catch {
      throw new HermesError("No se pudo conectar con ElevenLabs. Comprueba la conexión a internet.");
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new HermesError(
        response.status === 401 || response.status === 403
          ? "La API key de ElevenLabs no es válida o no tiene permiso de síntesis (text_to_speech)."
          : `ElevenLabs respondió ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
      );
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) throw new HermesError("ElevenLabs devolvió audio vacío.");
    return { bytes: new Uint8Array(buffer), mimeType: "audio/mpeg" };
  }

  async transcribe(audio: Blob, signal?: AbortSignal): Promise<string> {
    const apiKey = this.settings.elevenLabsKey.trim();
    if (!apiKey) {
      throw new HermesError("Falta la API key de ElevenLabs. Añádela en Ajustes para dictar.");
    }

    const extension = audio.type.includes("mp4") ? "m4a" : audio.type.includes("wav") ? "wav" : "webm";
    const form = new FormData();
    form.append("file", audio, `voice.${extension}`);
    form.append("model_id", "scribe_v2");
    form.append("language_code", "spa");

    let response: Response;
    try {
      response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new HermesError("No se pudo conectar con ElevenLabs para transcribir.");
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new HermesError(
        response.status === 401 || response.status === 403
          ? "La API key de ElevenLabs no tiene permiso de transcripción (speech_to_text)."
          : `ElevenLabs respondió ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => null)) as { text?: unknown } | null;
    return typeof payload?.text === "string" ? payload.text.trim() : "";
  }

  async startRun(input: string, sessionId: string, instructions: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/runs`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          input,
          session_id: sessionId,
          instructions,
          model: this.settings.model.trim() || "hermes-agent",
        }),
      });
    } catch {
      throw new HermesError("No se pudo conectar con JARVIS. Verifica que Hermes local esté activo en http://127.0.0.1:8643/v1.");
    }

    if (!response.ok) {
      const detail = await safeText(response);
      throw new HermesError(
        response.status === 401
          ? "La API key de JARVIS (Hermes) no es válida (API_SERVER_KEY)."
          : `JARVIS respondió ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
      );
    }

    const payload = (await response.json().catch(() => null)) as { run_id?: unknown; id?: unknown } | null;
    const runId = typeof payload?.run_id === "string" ? payload.run_id : typeof payload?.id === "string" ? payload.id : "";
    if (!runId) throw new HermesError("JARVIS no devolvió un run_id.");
    return runId;
  }

  async streamRun(runId: string, onEvent: (event: RunEvent) => void, signal?: AbortSignal): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/runs/${encodeURIComponent(runId)}/events`, {
        headers: { Authorization: `Bearer ${this.settings.hermesKey.trim()}`, Accept: "text/event-stream" },
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new HermesError("No se pudo abrir el stream de JARVIS.");
    }

    if (!response.ok || !response.body) {
      throw new HermesError(`No se pudo abrir el stream de JARVIS (${response.status}).`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        try {
          onEvent(JSON.parse(data) as RunEvent);
        } catch {
          /* ignore malformed/keepalive frame */
        }
      }
    }
  }

  async stopRun(runId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/runs/${encodeURIComponent(runId)}/stop`, {
        method: "POST",
        headers: this.headers(),
      });
    } catch {
      /* best effort */
    }
  }

  async getToolsets(): Promise<Array<{ name: string; enabled: boolean; tools: string[] }>> {
    const root = this.baseUrl.replace(/\/v1\/?$/, "");
    try {
      const response = await fetch(`${root}/v1/toolsets`, { headers: this.headers() });
      if (!response.ok) return [];
      const payload = (await response.json().catch(() => null)) as
        | { data?: Array<{ name?: unknown; enabled?: unknown; tools?: unknown }> }
        | null;
      return (payload?.data ?? [])
        .filter((row) => typeof row.name === "string")
        .map((row) => ({
          name: row.name as string,
          enabled: row.enabled === true,
          tools: Array.isArray(row.tools)
            ? row.tools.filter((tool): tool is string => typeof tool === "string")
            : [],
        }));
    } catch {
      return [];
    }
  }

  async getGatewayStatus(): Promise<{ activeRuns: number; activeDelegations: number } | null> {
    const root = this.baseUrl.replace(/\/v1\/?$/, "");
    try {
      const response = await fetch(`${root}/health/detailed`, { headers: this.headers() });
      if (!response.ok) return null;
      const payload = (await response.json().catch(() => null)) as
        | {
            api_server?: { active_runs?: unknown };
            readiness?: { checks?: { background_queues?: { active_api_runs?: unknown; active_delegations?: unknown } } };
          }
        | null;
      const background = payload?.readiness?.checks?.background_queues;
      const activeRuns = Number(payload?.api_server?.active_runs ?? background?.active_api_runs ?? 0);
      const activeDelegations = Number(background?.active_delegations ?? 0);
      return {
        activeRuns: Number.isFinite(activeRuns) ? activeRuns : 0,
        activeDelegations: Number.isFinite(activeDelegations) ? activeDelegations : 0,
      };
    } catch {
      return null;
    }
  }

  async getSession(sessionId: string): Promise<SessionRow | null> {
    const response = await fetch(`${this.apiRoot}/api/sessions/${encodeURIComponent(sessionId)}`, {
      headers: this.headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as { session?: SessionRow } | SessionRow | null;
    if (!payload) return null;
    const wrapped = payload as { session?: SessionRow };
    if (wrapped.session) return wrapped.session;
    return payload as SessionRow;
  }

  async getSessionMessages(sessionId: string, limit = 24): Promise<SessionMessage[]> {
    const response = await fetch(
      `${this.apiRoot}/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}&order=latest`,
      { headers: this.headers() },
    );
    if (!response.ok) return [];
    const payload = (await response.json().catch(() => null)) as
      | { data?: SessionMessage[]; messages?: SessionMessage[] }
      | null;
    const messages = payload?.data ?? payload?.messages ?? [];
    return [...messages].sort((left, right) => {
      const leftId = Number(left.id);
      const rightId = Number(right.id);
      if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
        return leftId - rightId;
      }
      return Number(left.timestamp ?? 0) - Number(right.timestamp ?? 0);
    });
  }

  private get apiRoot(): string {
    return this.baseUrl.replace(/\/v1\/?$/, "");
  }
}

export type RunEvent = {
  event: string;
  run_id: string;
  timestamp?: number;
  seq?: number;
  [key: string]: unknown;
};

export type SessionRow = {
  id: string;
  title?: string;
  model?: string;
  started_at?: number;
  ended_at?: number | null;
  estimated_cost_usd?: number;
  actual_cost_usd?: number | null;
  input_tokens?: number;
  output_tokens?: number;
  parent_session_id?: string | null;
  is_internal_child?: boolean;
  preview?: string;
  [key: string]: unknown;
};

export type SessionMessage = {
  id: number | string;
  role: string;
  content?: string | null;
  tool_name?: string | null;
  tool_calls?: unknown;
  timestamp?: number;
  display_kind?: string | null;
  [key: string]: unknown;
};

async function safeText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}
