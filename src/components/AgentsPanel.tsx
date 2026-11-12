import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { AgentCard } from "../types";
import { ChatIcon, EditIcon, PlusIcon } from "./Icons";

const STATUS_LABEL: Record<AgentCard["status"], string> = {
  idle: "En espera",
  running: "En ejecución",
  done: "Completado",
  error: "Error",
};

function formatElapsed(agent: AgentCard, now: number): string {
  if (!agent.startedAt) return "—";
  const end = agent.endedAt ?? now;
  const seconds = Math.max(0, Math.floor((end - agent.startedAt) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatCost(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(value < 0.01 ? 5 : 4)}`;
}

function formatTokens(agent: AgentCard): string {
  const input = agent.inputTokens ?? 0;
  const output = agent.outputTokens ?? 0;
  if (input === 0 && output === 0) return "—";
  return `${input.toLocaleString("es-ES")} in / ${output.toLocaleString("es-ES")} out`;
}

export function AgentsPanel() {
  const agents = useStore((state) => state.agents);
  const agentLog = useStore((state) => state.agentLog);
  const configs = useStore((state) => state.settings.agentConfigs);
  const openAgentChat = useStore((state) => state.openAgentChat);
  const openAgentEditor = useStore((state) => state.openAgentEditor);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const configured = configs.filter((config) => config.enabled).map((config) => config.id);
  const cards = [
    ...configured.map((id) => agents[id]).filter((agent): agent is AgentCard => Boolean(agent)),
    ...Object.values(agents).filter((agent) => !configured.includes(agent.id)),
  ];
  const configIds = new Set(configs.map((config) => config.id));

  return (
    <aside className="agents-panel" aria-label="Agentes">
      <header className="agents-head">
        <div>
          <span className="eyebrow">AGENTES</span>
          <span className="agents-count">{cards.filter((agent) => agent.status === "running").length} activos</span>
        </div>
        <div className="agents-head-actions">
          <button type="button" onClick={() => openAgentEditor("new")} title="Crear agente" aria-label="Crear agente">
            <PlusIcon size={14} />
          </button>
          <button type="button" onClick={() => openAgentEditor(null)} title="Editar agentes" aria-label="Editar agentes">
            <EditIcon size={14} />
          </button>
        </div>
      </header>

      <div className="agents-list">
        {cards.map((agent) => (
          <section key={agent.id} className={`agent-card agent-${agent.status}`}>
            <div className="agent-card-top">
              <span className="agent-dot" />
              <div className="agent-name-block">
                <span className="agent-name">{agent.name}</span>
                <span className="agent-role">{agent.role}</span>
              </div>
              <div className="agent-card-tools">
                <span className="agent-status">{STATUS_LABEL[agent.status]}</span>
                {configIds.has(agent.id) ? (
                  <button
                    type="button"
                    className="agent-edit-btn"
                    onClick={() => openAgentEditor(agent.id)}
                    aria-label={`Editar ${agent.name}`}
                    title={`Editar ${agent.name}`}
                  >
                    <EditIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="agent-chat-btn"
                  onClick={() => openAgentChat(agent.id)}
                  aria-label={`Ver chat de ${agent.name}`}
                  title={`Ver chat de ${agent.name}`}
                >
                  <ChatIcon />
                </button>
              </div>
            </div>

            {agent.task ? <p className="agent-task">{agent.task}</p> : null}
            {agent.lastOperation && agent.status === "running" ? (
              <p className="agent-last">{agent.lastOperation}</p>
            ) : null}

            <div className="agent-meta">
              <span title="Tiempo de la tarea">{formatElapsed(agent, now)}</span>
              <span title="Coste estimado">{formatCost(agent.costUsd)}</span>
              <span title="Tokens">{formatTokens(agent)}</span>
            </div>
          </section>
        ))}
      </div>

      <div className="agents-log">
        <span className="eyebrow">COMUNICACIÓN</span>
        {agentLog.length === 0 ? (
          <p className="agent-log-empty">JARVIS esperando una tarea…</p>
        ) : (
          agentLog
            .slice()
            .reverse()
            .map((entry) => <p key={entry.id} className="agent-log-row">{entry.text}</p>)
        )}
      </div>
    </aside>
  );
}
