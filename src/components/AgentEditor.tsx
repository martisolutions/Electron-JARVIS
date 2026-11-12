import { useEffect, useState, type FormEvent } from "react";
import { useStore } from "../store";
import type { AgentConfig } from "../types";
import { CloseIcon, PlusIcon, TrashIcon } from "./Icons";

export function AgentEditor() {
  const open = useStore((state) => state.agentEditor);
  const stored = useStore((state) => state.settings.agentConfigs);
  const saveAgentConfigs = useStore((state) => state.saveAgentConfigs);
  const closeAgentEditor = useStore((state) => state.closeAgentEditor);
  const [draft, setDraft] = useState<AgentConfig[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const copy = stored.map((agent) => ({ ...agent }));
    setDraft(copy);
    const initial =
      open !== "manage" && copy.some((agent) => agent.id === open)
        ? open
        : (copy.find((agent) => !agent.primary)?.id ?? copy[0]?.id ?? "");
    setSelectedId(initial);
    setError("");
  }, [open, stored]);

  if (!open) return null;

  const selected = draft.find((agent) => agent.id === selectedId) ?? null;

  function updateSelected(patch: Partial<AgentConfig>): void {
    setDraft((current) =>
      current.map((agent) => (agent.id === selectedId ? { ...agent, ...patch } : agent)),
    );
    setError("");
  }

  function addAgent(): void {
    const id = `agent-${Date.now().toString(36)}`;
    const agent: AgentConfig = {
      id,
      name: "Nuevo agente",
      role: "Subagente",
      trigger: "",
      enabled: true,
      instructions: "",
    };
    setDraft((current) => [...current, agent]);
    setSelectedId(id);
    setError("");
  }

  function removeAgent(): void {
    if (!selected || selected.primary) return;
    if (!window.confirm(`¿Eliminar el agente "${selected.name}"?`)) return;
    const next = draft.filter((agent) => agent.id !== selected.id);
    setDraft(next);
    setSelectedId(next.find((agent) => !agent.primary)?.id ?? next[0]?.id ?? "");
    setError("");
  }

  function save(event: FormEvent): void {
    event.preventDefault();
    const triggers = new Map<string, string>();
    for (const agent of draft) {
      if (agent.primary) continue;
      const trigger = (agent.trigger ?? "").trim();
      if (!agent.enabled) continue;
      if (!trigger) {
        setSelectedId(agent.id);
        setError("Cada agente activo necesita un prefijo (por ejemplo TARIC).");
        return;
      }
      const key = trigger.toLowerCase();
      if (triggers.has(key)) {
        setSelectedId(agent.id);
        setError(`El prefijo "${trigger}" ya lo usa ${triggers.get(key)}.`);
        return;
      }
      triggers.set(key, agent.name);
    }
    saveAgentConfigs(draft);
    closeAgentEditor();
  }

  return (
    <div className="agent-editor-overlay" role="dialog" aria-modal="true" aria-label="Configurar agentes">
      <form className="agent-editor" onSubmit={save}>
        <header className="agent-editor-head">
          <div>
            <span className="eyebrow">CONFIGURACIÓN</span>
            <h2>Agentes</h2>
            <p>Los agentes son roles de la app. El prefijo es el que JARVIS usa para delegar.</p>
          </div>
          <button type="button" onClick={closeAgentEditor} aria-label="Cerrar">
            <CloseIcon />
          </button>
        </header>

        <div className="agent-editor-layout">
          <aside className="agent-editor-list">
            <div className="agent-editor-list-head">
              <span className="eyebrow">AGENTES</span>
              <button type="button" onClick={addAgent} title="Crear agente">
                <PlusIcon />
              </button>
            </div>
            {draft.map((agent) => (
              <button
                key={agent.id}
                type="button"
                className={`agent-editor-row ${agent.id === selectedId ? "is-selected" : ""}`}
                onClick={() => {
                  setSelectedId(agent.id);
                  setError("");
                }}
              >
                <i />
                <span>
                  <strong>{agent.name}</strong>
                  <small>
                    {agent.primary ? "Principal" : agent.trigger ? `${agent.trigger}:` : "Sin prefijo"}
                    {agent.enabled ? "" : " · desactivado"}
                  </small>
                </span>
              </button>
            ))}
          </aside>

          <section className="agent-editor-form">
            {selected ? (
              <>
                <div className="agent-editor-form-head">
                  <div>
                    <span className="eyebrow">{selected.primary ? "AGENTE PRINCIPAL" : "SUBAGENTE"}</span>
                    <h3>{selected.name || "Sin nombre"}</h3>
                  </div>
                  {!selected.primary ? (
                    <button type="button" className="agent-editor-delete" onClick={removeAgent}>
                      <TrashIcon />
                      Eliminar
                    </button>
                  ) : null}
                </div>

                <label>
                  Nombre
                  <input
                    value={selected.name}
                    onChange={(event) => updateSelected({ name: event.target.value })}
                    maxLength={40}
                    required
                  />
                </label>

                <label>
                  Rol / descripción corta
                  <input
                    value={selected.role}
                    onChange={(event) => updateSelected({ role: event.target.value })}
                    maxLength={80}
                    required
                  />
                </label>

                <label>
                  Prefijo de delegación
                  <input
                    value={selected.trigger ?? ""}
                    onChange={(event) => updateSelected({ trigger: event.target.value.toUpperCase() })}
                    placeholder="Ej. EMAIL"
                    maxLength={30}
                    disabled={selected.primary || selected.builtin}
                    required={!selected.primary}
                  />
                  <small>
                    {selected.primary
                      ? "JARVIS no se delega: es el agente principal."
                      : selected.builtin
                        ? "El prefijo de los agentes integrados está fijado para conservar sus reglas."
                        : "JARVIS usará este prefijo al delegar, por ejemplo EMAIL: …"}
                  </small>
                </label>

                {!selected.primary ? (
                  <label className="agent-editor-toggle">
                    <input
                      type="checkbox"
                      checked={selected.enabled}
                      onChange={(event) => updateSelected({ enabled: event.target.checked })}
                    />
                    Agente activo
                  </label>
                ) : null}

                <label>
                  Instrucciones para JARVIS
                  <textarea
                    value={selected.instructions}
                    onChange={(event) => updateSelected({ instructions: event.target.value })}
                    rows={9}
                    maxLength={4000}
                    placeholder={
                      selected.primary
                        ? "El prompt principal de JARVIS ya está definido por la app."
                        : "Ej. Cuando Jordi pida… delega en este agente con un goal que empiece por 'PREFIJO:'."
                    }
                  />
                </label>

                {error ? <p className="agent-editor-error">{error}</p> : null}

                <div className="agent-editor-actions">
                  <button type="button" onClick={closeAgentEditor}>
                    Cancelar
                  </button>
                  <button type="submit" className="primary">
                    Guardar agentes
                  </button>
                </div>
              </>
            ) : (
              <p className="agent-editor-empty">Crea un agente para empezar.</p>
            )}
          </section>
        </div>
      </form>
    </div>
  );
}
