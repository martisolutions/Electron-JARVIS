import { useEffect, useState } from "react";
import { useStore } from "../store";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { EditIcon, PlusIcon } from "./Icons";
import type { BillingSnapshot, SystemMetrics } from "../types";

type Props = {
  metrics: SystemMetrics | null;
};

function percent(value: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function formatUptime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":");
}

export function HudUptime({ metrics }: Props) {
  return <span className="hud-uptime">{formatUptime(metrics?.uptime ?? 0)}</span>;
}

export function HudLeftPanels({ metrics }: Props) {
  const cores = metrics?.cores?.slice(0, 16) ?? Array.from({ length: 8 }, () => 0);
  const ramPercent = metrics ? percent(metrics.ramUsed, metrics.ramTotal) : 0;
  const ringLength = 289;

  return (
    <div className="hud-col hud-col-left">
      <section className="hud-panel">
        <div className="hud-panel-head">
          <span>CPU CORES</span>
          <strong>{Math.round(metrics?.cpu ?? 0)}%</strong>
        </div>
        <div className="hud-cores">
          {cores.map((core, index) => (
            <div className="hud-core-row" key={index}>
              <span>C{index}</span>
              <div className="hud-track">
                <i style={{ width: `${Math.max(0, Math.min(100, core))}%` }} />
              </div>
              <b>{Math.round(core)}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="hud-panel">
        <div className="hud-panel-head">
          <span>MEMORY</span>
          <strong>{metrics ? `${metrics.ramTotal.toFixed(0)} GB` : "—"}</strong>
        </div>
        <div className="hud-ram">
          <svg viewBox="0 0 120 120" aria-label="Uso de RAM">
            <circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,154,31,.16)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="46"
              fill="none"
              stroke="#ff9a1f"
              strokeWidth="10"
              strokeDasharray={ringLength}
              strokeDashoffset={ringLength * (1 - ramPercent / 100)}
              transform="rotate(-90 60 60)"
            />
            <text x="60" y="66" textAnchor="middle" className="hud-ram-value">
              {Math.round(ramPercent)}%
            </text>
          </svg>
          <div className="hud-ram-copy">
            <span>USED</span>
            <strong>{metrics ? `${metrics.ramUsed.toFixed(1)} GB` : "—"}</strong>
            <span>CACHE</span>
            <strong>{metrics ? `${metrics.ramCache.toFixed(1)} GB` : "—"}</strong>
          </div>
        </div>
      </section>
      <ArtifactsPanel />
    </div>
  );
}

const AGENT_STATUS: Record<string, string> = {
  idle: "EN ESPERA",
  running: "TRABAJANDO",
  done: "LISTO",
  error: "ERROR",
};

function HudAgentsPanel() {
  const agents = useStore((state) => state.agents);
  const configs = useStore((state) => state.settings.agentConfigs);
  const openAgentChat = useStore((state) => state.openAgentChat);
  const openAgentEditor = useStore((state) => state.openAgentEditor);
  const configured = configs.filter((config) => config.enabled).map((config) => config.id);
  const cards = [
    ...configured.map((id) => agents[id]).filter(Boolean),
    ...Object.values(agents).filter((agent) => !configured.includes(agent.id)),
  ];
  const running = cards.filter((agent) => agent.status === "running").length;

  return (
    <section className="hud-panel hud-agents-panel">
      <div className="hud-panel-head">
        <span>AGENTS</span>
        <div className="hud-agents-head-actions">
          <strong>{running} activos</strong>
          <button type="button" onClick={() => openAgentEditor("new")} aria-label="Crear agente" title="Crear agente">
            <PlusIcon size={12} />
          </button>
          <button type="button" onClick={() => openAgentEditor(null)} aria-label="Editar agentes" title="Editar agentes">
            <EditIcon size={12} />
          </button>
        </div>
      </div>
      <div className="hud-agents-list">
        {cards.map((agent) => (
          <div className={`hud-agent-row hud-agent-${agent.status}`} key={agent.id}>
            <i />
            <button type="button" className="hud-agent-main" onClick={() => openAgentChat(agent.id)}>
              <span>{agent.name}</span>
              <small>{agent.task || agent.lastOperation || agent.role}</small>
            </button>
            <b>{AGENT_STATUS[agent.status] ?? agent.status}</b>
            <button
              type="button"
              className="hud-agent-edit"
              onClick={() => openAgentEditor(agent.id)}
              aria-label={`Editar ${agent.name}`}
              title={`Editar ${agent.name}`}
            >
              <EditIcon size={11} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
type RightProps = Props & { billing: BillingSnapshot | null };

export function HudRightPanels({ metrics, billing }: RightProps) {
  const [readHistory, setReadHistory] = useState<number[]>(() => Array(30).fill(0));
  const [writeHistory, setWriteHistory] = useState<number[]>(() => Array(30).fill(0));

  useEffect(() => {
    if (!metrics) return;
    setReadHistory((history) => [...history.slice(1), metrics.diskRead]);
    setWriteHistory((history) => [...history.slice(1), metrics.diskWrite]);
  }, [metrics?.diskRead, metrics?.diskWrite]);

  const vramPercent = metrics ? percent(metrics.vramUsed, metrics.vramTotal) : 0;
  const elevenRemaining = billing?.elevenLabs ? Math.round(billing.elevenLabs.remaining).toLocaleString("es-ES") : "—";
  const elevenUsed = billing?.elevenLabs ? Math.round(billing.elevenLabs.used).toLocaleString("es-ES") : "—";
  const elevenLimit = billing?.elevenLabs ? Math.round(billing.elevenLabs.limit).toLocaleString("es-ES") : "—";
  const max = Math.max(4, ...readHistory, ...writeHistory);
  const toPoints = (values: number[]): string =>
    values.map((value, index) => `${(index * 260) / 29},${68 - (value / max) * 56}`).join(" ");

  return (
    <div className="hud-col hud-col-right">
      <section className="hud-panel">
        <div className="hud-panel-head">
          <span>VRAM</span>
          <strong>{metrics ? `${metrics.vramUsed.toFixed(1)} / ${metrics.vramTotal.toFixed(0)} GB` : "—"}</strong>
        </div>
        <div className="hud-segment">
          <i style={{ width: `${vramPercent}%` }} />
        </div>
        <div className="hud-kv">
          <span>GPU TEMP</span>
          <strong>{metrics ? `${metrics.gpuTemp} °C` : "—"}</strong>
        </div>
        <div className="hud-kv">
          <span>GPU LOAD</span>
          <strong>{metrics ? `${metrics.gpuLoad} %` : "—"}</strong>
        </div>
        <div className="hud-kv hud-gpu-name">
          <span>DEVICE</span>
          <strong>{metrics?.gpuName ?? "—"}</strong>
        </div>
      </section>

      <section className="hud-panel">
        <div className="hud-panel-head">
          <span>DISK I/O</span>
          <strong>NVMe</strong>
        </div>
        <svg className="hud-disk-chart" viewBox="0 0 260 70" aria-label="Lectura y escritura de disco">
          <polyline points={toPoints(readHistory)} fill="none" stroke="#ff9a1f" strokeWidth="2" />
          <polyline points={toPoints(writeHistory)} fill="none" stroke="#ffd9a0" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
        <div className="hud-kv">
          <span>READ</span>
          <strong>{metrics ? `${metrics.diskRead.toFixed(0)} MB/s` : "—"}</strong>
        </div>
        <div className="hud-kv">
          <span>WRITE</span>
          <strong>{metrics ? `${metrics.diskWrite.toFixed(0)} MB/s` : "—"}</strong>
        </div>
      </section>
      <HudAgentsPanel />
      <section className="hud-panel hud-billing">
        <div className="hud-panel-head">
          <span>CREDITS / BALANCE</span>
          <strong>LIVE</strong>
        </div>
        <div className="hud-billing-block">
          <div className="hud-kv">
            <span>ELEVENLABS</span>
            <strong>{elevenRemaining} chars</strong>
          </div>
          <div className="hud-bill-track">
            <i style={{ width: `${billing?.elevenLabs?.percent ?? 0}%` }} />
          </div>
          <small>
            {billing?.elevenLabs ? `${elevenUsed} / ${elevenLimit} usados` : "Sin datos"}
          </small>
        </div>
        <div className="hud-billing-block">
          <div className="hud-kv">
            <span>DEEPSEEK SALDO</span>
            <strong>{billing?.deepseek ? `${billing.deepseek.currency} ${billing.deepseek.total.toFixed(2)}` : "—"}</strong>
          </div>
          <div className="hud-kv">
            <span>GASTADO</span>
            <strong>{billing?.deepseek ? `${billing.deepseek.currency} ${billing.deepseek.spent.toFixed(2)}` : "—"}</strong>
          </div>
        </div>
      </section>    </div>
  );
}
