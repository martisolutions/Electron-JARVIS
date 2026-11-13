import { useEffect, useState } from "react";
import type { SystemMetrics } from "../types";

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

      <section className="hud-panel hud-panel-grow">
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
    </div>
  );
}

export function HudRightPanels({ metrics }: Props) {
  const [readHistory, setReadHistory] = useState<number[]>(() => Array(30).fill(0));
  const [writeHistory, setWriteHistory] = useState<number[]>(() => Array(30).fill(0));

  useEffect(() => {
    if (!metrics) return;
    setReadHistory((history) => [...history.slice(1), metrics.diskRead]);
    setWriteHistory((history) => [...history.slice(1), metrics.diskWrite]);
  }, [metrics?.diskRead, metrics?.diskWrite]);

  const vramPercent = metrics ? percent(metrics.vramUsed, metrics.vramTotal) : 0;
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

      <section className="hud-panel hud-panel-grow">
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
    </div>
  );
}
