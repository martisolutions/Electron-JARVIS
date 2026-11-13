import { useEffect, useState } from "react";
import type { ArtifactItem, ArtifactSnapshot } from "../types";

type Bridge = {
  listArtifacts?: () => Promise<ArtifactSnapshot>;
  markArtifactSeen?: (id: string) => Promise<ArtifactSnapshot>;
  openArtifact?: (id: string) => Promise<boolean>;
  revealArtifact?: (id: string) => Promise<boolean>;
};

function getBridge(): Bridge | undefined {
  return (window as unknown as { jarvisDesktop?: Bridge }).jarvisDesktop;
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

export function ArtifactsPanel() {
  const [snapshot, setSnapshot] = useState<ArtifactSnapshot>({ artifacts: [], unseen: 0 });
  const [selected, setSelected] = useState<ArtifactItem | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge?.listArtifacts) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const next = await bridge.listArtifacts?.();
        if (!cancelled && next) setSnapshot(next);
      } catch {
        /* best effort */
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function selectArtifact(item: ArtifactItem): Promise<void> {
    setSelected(item);
    const bridge = getBridge();
    if (bridge?.markArtifactSeen) {
      try {
        const next = await bridge.markArtifactSeen(item.id);
        if (next) setSnapshot(next);
      } catch {
        /* best effort */
      }
    }
  }

  async function runAction(action: "open" | "reveal"): Promise<void> {
    if (!selected) return;
    const bridge = getBridge();
    try {
      if (action === "open") await bridge?.openArtifact?.(selected.id);
      else await bridge?.revealArtifact?.(selected.id);
    } catch {
      /* best effort */
    }
  }

  return (
    <section className="hud-panel hud-artifacts">
      <div className="hud-panel-head">
        <span>GENERATED</span>
        <strong className={snapshot.unseen > 0 ? "hud-artifact-badge" : ""}>
          {snapshot.unseen > 0 ? `+${snapshot.unseen}` : "0"}
        </strong>
      </div>
      <div className="hud-artifact-list">
        {snapshot.artifacts.length === 0 ? (
          <p className="hud-artifact-empty">Sin eventos ni accesos generados.</p>
        ) : (
          snapshot.artifacts.map((item) => (
            <div key={item.id} className={`hud-artifact ${selected?.id === item.id ? "is-selected" : ""}`}>
              <button type="button" className="hud-artifact-card" onClick={() => void selectArtifact(item)}>
                <span className="hud-artifact-kind">{item.kind === "calendar" ? "ICAL" : "LNK"}</span>
                <span className="hud-artifact-name">{item.name}</span>
                <time>{formatDate(item.mtime)}</time>
                {item.unseen ? <i className="hud-artifact-new" /> : null}
              </button>
              {selected?.id === item.id ? (
                <div className="hud-artifact-actions">
                  <button type="button" onClick={() => void runAction("open")}>
                    Ejecutar
                  </button>
                  <button type="button" onClick={() => void runAction("reveal")}>
                    Ver en Explorador
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
