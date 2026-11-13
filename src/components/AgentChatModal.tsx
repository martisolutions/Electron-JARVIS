import { useEffect, useState } from "react";
import { useStore } from "../store";
import { parseTranscript, TRANSCRIPT_ROLE_LABEL, type TranscriptLine } from "../lib/transcript";
import { CloseIcon } from "./Icons";

type ChatBridge = {
  readHermesLog?: (path: string) => Promise<string>;
};

function getBridge(): ChatBridge | undefined {
  return (window as unknown as { jarvisDesktop?: ChatBridge }).jarvisDesktop;
}

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export function AgentChatModal() {
  const agentId = useStore((state) => state.agentChat);
  const closeAgentChat = useStore((state) => state.closeAgentChat);
  const agent = useStore((state) => (agentId ? state.agents[agentId] : null));
  const messages = useStore((state) => state.messages);
  const agentLog = useStore((state) => state.agentLog);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!agentId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAgentChat();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agentId, closeAgentChat]);

  useEffect(() => {
    if (!agentId || agentId === "jarvis" || !agent?.transcriptPath) {
      setTranscript([]);
      setLoading(false);
      setError("");
      return;
    }

    const bridge = getBridge();
    if (!bridge?.readHermesLog) {
      setError("No se puede leer el historial del subagente.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    void bridge
      .readHermesLog(agent.transcriptPath)
      .then((text) => {
        if (cancelled) return;
        setTranscript(parseTranscript(text));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("No se pudo leer el historial del subagente.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, agent?.transcriptPath, nonce]);

  if (!agentId || !agent) return null;

  const isJarvis = agentId === "jarvis";
  const relatedLog = agentLog.filter((entry) => entry.text.includes(agent.name));
  const hasTranscript = transcript.length > 0;

  return (
    <div className="agent-chat-overlay" role="dialog" aria-modal="true" aria-label={`Chat de ${agent.name}`}>
      <div className="agent-chat-modal">
        <header className="agent-chat-head">
          <div>
            <span className="eyebrow">CHAT DEL AGENTE</span>
            <h2>{agent.name}</h2>
            <p>
              {agent.role} Â· {agent.status === "running" ? "En ejecuciÃ³n" : agent.status === "done" ? "Completado" : agent.status === "error" ? "Error" : "En espera"}
            </p>
          </div>
          <div className="agent-chat-head-actions">
            {!isJarvis && agent.transcriptPath ? (
              <button type="button" onClick={() => setNonce((value) => value + 1)} disabled={loading}>
                Recargar
              </button>
            ) : null}
            <button type="button" onClick={closeAgentChat} aria-label="Cerrar chat">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="agent-chat-body">
          {isJarvis ? (
            messages.length === 0 ? (
              <p className="agent-chat-empty">JARVIS aÃºn no ha hablado en esta sesiÃ³n.</p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={`agent-chat-bubble role-${message.role}`}>
                  <span>
                    {message.role === "user" ? "Jordi" : message.role === "system" ? "Sistema" : "JARVIS"}
                    <time>{formatTime(message.at)}</time>
                  </span>
                  <p>{message.text}</p>
                </div>
              ))
            )
          ) : loading ? (
            <p className="agent-chat-empty">Cargando historialâ€¦</p>
          ) : error ? (
            <p className="agent-chat-empty">{error}</p>
          ) : hasTranscript ? (
            transcript.map((line, index) => (
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
            <div className="agent-chat-empty">
              <p>Este agente todavÃ­a no tiene un historial de conversaciÃ³n.</p>
              {agent.task ? <p className="agent-chat-task">Tarea: {agent.task}</p> : null}
              {agent.summary ? <p className="agent-chat-task">Resumen: {agent.summary}</p> : null}
              {relatedLog.length > 0 ? (
                <div className="agent-chat-log">
                  {relatedLog.map((entry) => (
                    <p key={entry.id}>{entry.text}</p>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <footer className="agent-chat-foot">
          <span>{isJarvis ? "ConversaciÃ³n principal" : hasTranscript ? "Ãšltimo historial del subagente" : "Sin historial todavÃ­a"}</span>
          <button type="button" onClick={closeAgentChat}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}

