import { useEffect, useState, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";
import type { JarvisPanel, PanelKind, PanelState } from "../types";
import { CloseIcon, EditIcon, PlusIcon, TrashIcon } from "./Icons";

type PanelBridge = {
  listPanels: () => Promise<PanelState>;
  createPanel: (input: Partial<JarvisPanel>) => Promise<JarvisPanel>;
  updatePanel: (id: string, input: Partial<JarvisPanel>) => Promise<JarvisPanel | null>;
  deletePanel: (id: string) => Promise<boolean>;
  setPanelOpen: (id: string, open: boolean) => Promise<boolean>;
  onPanelsChanged?: (callback: (state: PanelState) => void) => () => void;
  onPanelOpen?: (callback: (state: PanelState & { id: string }) => void) => () => void;
};

type EditorState = {
  mode: "new" | "edit";
  panel?: JarvisPanel;
  title: string;
  kind: PanelKind;
  language: string;
  content: string;
};

const KIND_LABEL: Record<PanelKind, string> = {
  code: "Código",
  diagram: "Diagrama",
  text: "Explicación",
  markdown: "Markdown",
};

function getBridge(): PanelBridge | undefined {
  return (window as unknown as { jarvisDesktop?: PanelBridge }).jarvisDesktop;
}

function blankEditor(): EditorState {
  return {
    mode: "new",
    title: "Nuevo panel",
    kind: "code",
    language: "",
    content: "",
  };
}

export function Board() {
  const setBoardOpen = useStore((state) => state.setBoardOpen);
  const [state, setState] = useState<PanelState>({ panels: [], openIds: [] });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const api = getBridge();
    if (!api) return;
    let cancelled = false;

    void api
      .listPanels()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar el tablero.");
      });

    const offChanged = api.onPanelsChanged?.((next) => {
      if (!cancelled) setState(next);
    });
    const offOpen = api.onPanelOpen?.((next) => {
      if (!cancelled) setState({ panels: next.panels, openIds: next.openIds });
    });

    return () => {
      cancelled = true;
      offChanged?.();
      offOpen?.();
    };
  }, []);

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (editor) setEditor(null);
      else setBoardOpen(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [editor, setBoardOpen]);

  const openPanels = state.openIds
    .map((id) => state.panels.find((panel) => panel.id === id))
    .filter((panel): panel is JarvisPanel => Boolean(panel));

  function togglePanel(panel: JarvisPanel): void {
    const api = getBridge();
    if (!api) return;
    const nextOpen = !state.openIds.includes(panel.id);
    setState((current) => ({
      ...current,
      openIds: nextOpen
        ? [...current.openIds, panel.id]
        : current.openIds.filter((id) => id !== panel.id),
    }));
    void api.setPanelOpen(panel.id, nextOpen);
  }

  async function saveEditor(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!editor) return;
    const api = getBridge();
    if (!api) return;
    const input = {
      title: editor.title.trim() || "Panel",
      kind: editor.kind,
      language: editor.language.trim(),
      content: editor.content,
    };
    try {
      if (editor.mode === "new") await api.createPanel(input);
      else if (editor.panel) await api.updatePanel(editor.panel.id, input);
      setEditor(null);
      setError("");
    } catch {
      setError("No se pudo guardar el panel.");
    }
  }

  async function removePanel(panel: JarvisPanel): Promise<void> {
    if (!window.confirm(`¿Eliminar el panel "${panel.title}"?`)) return;
    const api = getBridge();
    if (!api) return;
    try {
      await api.deletePanel(panel.id);
      setError("");
    } catch {
      setError("No se pudo eliminar el panel.");
    }
  }

  return (
    <div className="board-overlay" role="dialog" aria-modal="true" aria-label="Tablero de JARVIS">
      <header className="board-head">
        <div>
          <span className="eyebrow">TABLERO</span>
          <h2>Espacio de trabajo</h2>
        </div>
        <div className="board-head-actions">
          <button type="button" className="board-new" onClick={() => setEditor(blankEditor())}>
            <PlusIcon />
            Nuevo panel
          </button>
          <button
            type="button"
            className="board-close"
            onClick={() => setBoardOpen(false)}
            aria-label="Cerrar tablero"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      {error ? <p className="board-error">{error}</p> : null}

      <div className="board-layout">
        <aside className="board-sidebar">
          <div className="board-sidebar-head">
            <span className="eyebrow">PANELES</span>
            <span>{state.panels.length}</span>
          </div>
          {state.panels.length === 0 ? (
            <p className="board-empty-hint">
              Aún no hay paneles. JARVIS puede crearlos o puedes crear uno tú.
            </p>
          ) : (
            <div className="board-selector">
              {state.panels.map((panel) => {
                const open = state.openIds.includes(panel.id);
                return (
                  <button
                    key={panel.id}
                    type="button"
                    className={`board-selector-row ${open ? "is-open" : ""}`}
                    onClick={() => togglePanel(panel)}
                    title={open ? "Ocultar panel" : "Abrir panel"}
                  >
                    <i />
                    <span>
                      <strong>{panel.title}</strong>
                      <small>
                        {KIND_LABEL[panel.kind]}
                        {panel.createdBy === "jarvis" ? " · JARVIS" : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <main className="board-canvas">
          {openPanels.length === 0 ? (
            <div className="board-empty">
              <span className="eyebrow">SIN PANELES ABIERTOS</span>
              <p>Selecciona uno en la izquierda o pide a JARVIS que cree uno.</p>
            </div>
          ) : (
            <div className="board-grid">
              {openPanels.map((panel) => {
                const isMarkdown =
                  panel.kind === "markdown" ||
                  (panel.kind === "text" && /markdown/i.test(panel.language ?? ""));
                return (
                <section key={panel.id} className={`board-panel kind-${panel.kind}`}>
                  <header className="board-panel-head">
                    <div>
                      <span className="board-panel-kind">
                        {KIND_LABEL[panel.kind]}
                        {panel.language ? ` · ${panel.language}` : ""}
                      </span>
                      <h3>{panel.title}</h3>
                    </div>
                    <div className="board-panel-actions">
                      <button
                        type="button"
                        onClick={() => setEditor({ mode: "edit", panel, title: panel.title, kind: panel.kind, language: panel.language ?? "", content: panel.content })}
                        aria-label="Editar panel"
                        title="Editar panel"
                      >
                        <EditIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => void removePanel(panel)}
                        aria-label="Eliminar panel"
                        title="Eliminar panel (solo el usuario)"
                      >
                        <TrashIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePanel(panel)}
                        aria-label="Ocultar panel"
                        title="Ocultar panel"
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </header>
                  <div className="board-panel-body">
                    {panel.kind === "code" ? (
                      <pre className="board-code">
                        <code>{panel.content || "// Panel vacío"}</code>
                      </pre>
                    ) : panel.kind === "diagram" ? (
                      <MermaidDiagram panel={panel} />
                    ) : isMarkdown ? (
                      <div className="board-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {panel.content || "_Panel vacío._"}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="board-text">{panel.content || "Panel vacío."}</div>
                    )}
                  </div>
                </section>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {editor ? (
        <form className="board-editor" onSubmit={(event) => void saveEditor(event)}>
          <div className="board-editor-card">
            <div className="board-editor-head">
              <div>
                <span className="eyebrow">{editor.mode === "new" ? "NUEVO PANEL" : "EDITAR PANEL"}</span>
                <h3>{editor.mode === "new" ? "Añadir al tablero" : editor.panel?.title}</h3>
              </div>
              <button type="button" onClick={() => setEditor(null)} aria-label="Cerrar editor">
                <CloseIcon />
              </button>
            </div>

            <label>
              Título
              <input
                value={editor.title}
                onChange={(event) => setEditor({ ...editor, title: event.target.value })}
                maxLength={120}
                required
              />
            </label>

            <div className="board-editor-row">
              <label>
                Tipo
                <select
                  value={editor.kind}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      kind: event.target.value as PanelKind,
                      language: event.target.value === "code" ? editor.language : "",
                    })
                  }
                >
                  <option value="code">Código</option>
                  <option value="diagram">Diagrama (Mermaid)</option>
                  <option value="text">Explicación</option>
                  <option value="markdown">Markdown</option>
                </select>
              </label>
              {editor.kind === "code" ? (
                <label>
                  Lenguaje
                  <input
                    value={editor.language}
                    onChange={(event) => setEditor({ ...editor, language: event.target.value })}
                    placeholder="ts, python, bash…"
                    maxLength={40}
                  />
                </label>
              ) : null}
            </div>

            <label>
              Contenido
              <textarea
                value={editor.content}
                onChange={(event) => setEditor({ ...editor, content: event.target.value })}
                rows={14}
                spellCheck={false}
                placeholder={
                  editor.kind === "diagram"
                    ? "graph TD\n  A[Inicio] --> B[Fin]"
                    : editor.kind === "code"
                      ? "// Escribe el código aquí"
                      : editor.kind === "markdown"
                        ? "# Título\n\nTexto con **negrita**, listas y tablas."
                        : "Escribe la explicación aquí"
                }
              />
            </label>

            <div className="board-editor-actions">
              <button type="button" onClick={() => setEditor(null)}>
                Cancelar
              </button>
              <button type="submit" className="primary">
                Guardar
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function MermaidDiagram({ panel }: { panel: JarvisPanel }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!panel.content.trim()) {
        setSvg("");
        setError("");
        return;
      }
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const id = `mermaid-${panel.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}`;
        const rendered = await mermaid.render(id, panel.content);
        if (!cancelled) {
          setSvg(rendered.svg);
          setError("");
        }
      } catch (renderError) {
        if (!cancelled) {
          setSvg("");
          setError(renderError instanceof Error ? renderError.message : "Diagrama no válido.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [panel.id, panel.content]);

  if (!panel.content.trim()) return <p className="board-empty-hint">Diagrama vacío.</p>;

  if (error) {
    return (
      <div className="board-diagram-error">
        <p>{error}</p>
        <pre>{panel.content}</pre>
      </div>
    );
  }

  return svg ? (
    <div className="board-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <p className="board-empty-hint">Renderizando diagrama…</p>
  );
}
