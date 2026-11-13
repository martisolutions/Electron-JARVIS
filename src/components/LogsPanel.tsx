import { useEffect, useMemo, useRef, useState } from "react";
import { parseTranscript, TRANSCRIPT_ROLE_LABEL, type TranscriptLine } from "../lib/transcript";
import { useStore } from "../store";
import type { ActivityKind } from "../types";
import { CloseIcon } from "./Icons";

type LogsBridge = {
  readHermesLog?: (path: string) => Promise<string>;
};

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  think: "Pensamiento",
  message: "Mensaje",
  tool: "Herramienta",
  result: "Resultado",
  info: "Info",
  error: "Error",
};

function getBridge(): LogsBridge | undefined {
  return (window as unknown as { jarvisDesktop?: LogsBridge }).jarvisDesktop;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function activityClass(kind: ActivityKind): string {
  if (kind === "think") return "role-think";
  if (kind === "tool") return "role-tool";
  if (kind === "result") return "role-result";
  if (kind === "error") return "role-error";
  return "role-message";
}

export function LogsPanel({ onClose }: { onClose: () => void }) {
  const agents = useStore((state) => state.agents);
  const activity = useStore((state) => state.activity);
  const [selectedId, setSelectedId] = useState("jarvis");
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const selectedAgent = selectedId === "jarvis" ? null : agents[selectedId] ?? null;
  const selectedActivity = useMemo(
    () => activity.filter((entry) => entry.agentId === (selectedId === "jarvis" ? "jarvis" : selectedId)),
    [activity, selectedId],
  );
  const tabs = useMemo(() => {
    const cards = Object.values(agents);
    if (!cards.some((agent) => agent.id === "jarvis")) {
      return [{ id: "jarvis", name: "JARVIS", status: "idle" as const }, ...cards];
    }
    return cards.sort((left, right) => (left.id === "jarvis" ? -1 : right.id === "jarvis" ? 1 : 0));
  }, [agents]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!selectedAgent?.transcriptPath) {
      setLines([]);
      setLoading(false);
      setError("");
      return;
    }
    const bridge = getBridge();
    const readLog = bridge?.readHermesLog;
    if (!readLog) {
      setLoading(false);
      setError("El historial en vivo solo está disponible en la app de escritorio.");
      return;
    }

    let cancelled = false;
    let busy = false;
    setLoading(true);
    setError("");

    const load = async (): Promise<void> => {
      if (busy || cancelled) return;
      busy = true;
      try {
        const text = await readLog(selectedAgent.transcriptPath as string);
        if (cancelled) return;
        setLines(parseTranscript(text));
        setError("");
      } catch {
        if (!cancelled) setError("No se pudo leer el log del agente.");
      } finally {
        busy = false;
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedAgent?.transcriptPath, nonce]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !stickToBottomRef.current) return;
    body.scrollTop = body.scrollHeight;
  }, [lines, selectedActivity, selectedId]);

  return (
    <div className="agent-chat-overlay" role="dialog" aria-modal="true" aria-label="Logs de agentes">
      <div className="agent-chat-modal logs-modal">
        <header className="agent-chat-head">
          <div>
            <span className="eyebrow">TELEMETRÍA DE AGENTES</span>
            <h2>Logs en vivo</h2>
            <p>{selectedAgent ? `${selectedAgent.name} · ${selectedAgent.role}` : "JARVIS · pensamiento y herramientas"}</p>
          </div>
          <div className="agent-chat-head-actions">
            <button type="button" onClick={() => setNonce((value) => value + 1)} disabled={loading}>
              Recargar
            </button>
            <button type="button" onClick={onClose} aria-label="Cerrar logs">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="logs-tabs" role="tablist" aria-label="Agentes">
          {tabs.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="tab"
              aria-selected={selectedId === agent.id}
              className={`logs-tab ${selectedId === agent.id ? "is-active" : ""}`}
              onClick={() => {
                stickToBottomRef.current = true;
                setSelectedId(agent.id);
              }}
            >
              <i className={`logs-dot agent-${agent.status}`} />
              {agent.name}
            </button>
          ))}
        </div>

        <div
          className="agent-chat-body logs-body"
          ref={bodyRef}
          onScroll={(event) => {
            const body = event.currentTarget;
            stickToBottomRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 72;
          }}
        >
          {selectedAgent?.transcriptPath ? (
            loading && lines.length === 0 ? (
              <p className="agent-chat-empty">Cargando pensamientos y herramientas…</p>
            ) : error ? (
              <p className="agent-chat-empty">{error}</p>
            ) : lines.length > 0 ? (
              lines.map((line, index) => (
                <div
                  key={`${line.time ?? "t"}-${index}-${line.role}`}
                  className={`agent-chat-line role-${line.role}`}
                >
                  <span>
                    {line.time ? <time>{line.time}</time> : null}
                    {TRANSCRIPT_ROLE_LABEL[line.role] ?? line.role}
                  </span>
                  <p>{line.text}</p>
                </div>
              ))
            ) : (
              <p className="agent-chat-empty">El agente todavía no ha escrito en su transcript.</p>
            )
          ) : selectedActivity.length > 0 ? (
            selectedActivity.map((entry) => (
              <div key={entry.id} className={`agent-chat-line ${activityClass(entry.kind)}`}>
                <span>
                  <time>{formatTime(entry.at)}</time>
                  {ACTIVITY_LABEL[entry.kind]}
                  {selectedId === "jarvis" ? " · JARVIS" : ""}
                </span>
                <p>{entry.text}</p>
              </div>
            ))
          ) : (
            <div className="agent-chat-empty">
              <p>No hay pensamientos ni actividad registrada todavía.</p>
              {selectedAgent?.task ? <p className="agent-chat-task">Tarea: {selectedAgent.task}</p> : null}
              {selectedAgent?.lastOperation ? (
                <p className="agent-chat-task">Última operación: {selectedAgent.lastOperation}</p>
              ) : null}
              {selectedAgent?.summary ? <p className="agent-chat-task">Resumen: {selectedAgent.summary}</p> : null}
            </div>
          )}
        </div>

        <footer className="agent-chat-foot">
          <span>
            {selectedAgent?.transcriptPath
              ? "Transcripción en vivo · se actualiza cada 1,2 s"
              : "Razonamiento y herramientas de JARVIS"}
          </span>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
