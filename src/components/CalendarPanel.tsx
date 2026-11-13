import { useEffect, useState } from "react";
import type { CalendarEvent } from "../types";
import { CloseIcon } from "./Icons";

type CalendarBridge = {
  listCalendarEvents?: () => Promise<{ events?: CalendarEvent[] }>;
  createCalendarEvent?: (input: Partial<CalendarEvent>) => Promise<CalendarEvent>;
  updateCalendarEvent?: (id: string, input: Partial<CalendarEvent>) => Promise<CalendarEvent | null>;
  deleteCalendarEvent?: (id: string) => Promise<boolean>;
  onCalendarChanged?: (callback: (state: { events?: CalendarEvent[] }) => void) => () => void;
};

type Draft = {
  title: string;
  start: string;
  end: string;
  description: string;
  location: string;
  alertMinutes: string;
};

function getBridge(): CalendarBridge | undefined {
  return (window as unknown as { jarvisDesktop?: CalendarBridge }).jarvisDesktop;
}

function toInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromInputValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function defaultStart(): string {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setSeconds(0, 0);
  return toInputValue(date.toISOString());
}

function emptyDraft(): Draft {
  return {
    title: "",
    start: defaultStart(),
    end: "",
    description: "",
    location: "",
    alertMinutes: "10",
  };
}

function eventDraft(event: CalendarEvent): Draft {
  return {
    title: event.title,
    start: toInputValue(event.start),
    end: event.end ? toInputValue(event.end) : "",
    description: event.description ?? "",
    location: event.location ?? "",
    alertMinutes: String(event.alertMinutes ?? 0),
  };
}

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CalendarPanel({ onClose }: { onClose: () => void }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge?.listCalendarEvents) return;
    let cancelled = false;
    void bridge.listCalendarEvents().then((state) => {
      if (!cancelled) setEvents(Array.isArray(state?.events) ? state.events : []);
    });
    const unsubscribe = bridge.onCalendarChanged?.((state) => {
      if (!cancelled) setEvents(Array.isArray(state?.events) ? state.events : []);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function resetForm(): void {
    setEditingId(null);
    setDraft(emptyDraft());
    setError("");
  }

  function editEvent(event: CalendarEvent): void {
    setEditingId(event.id);
    setDraft(eventDraft(event));
    setError("");
  }

  async function save(): Promise<void> {
    const bridge = getBridge();
    if (!bridge?.createCalendarEvent || !draft.title.trim() || !draft.start) {
      setError("Indica al menos título y fecha de inicio.");
      return;
    }
    const input: Partial<CalendarEvent> = {
      title: draft.title.trim(),
      start: fromInputValue(draft.start),
      end: draft.end ? fromInputValue(draft.end) : undefined,
      description: draft.description.trim(),
      location: draft.location.trim(),
      alertMinutes: Math.max(0, Number(draft.alertMinutes) || 0),
    };
    setSaving(true);
    setError("");
    try {
      if (editingId && bridge.updateCalendarEvent) await bridge.updateCalendarEvent(editingId, input);
      else await bridge.createCalendarEvent(input);
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el evento.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(): Promise<void> {
    if (!editingId || !window.confirm("¿Eliminar este evento?")) return;
    const bridge = getBridge();
    setSaving(true);
    try {
      await bridge?.deleteCalendarEvent?.(editingId);
      resetForm();
    } catch {
      setError("No se pudo eliminar el evento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="calendar-overlay" role="dialog" aria-modal="true" aria-label="Calendario JARVIS">
      <div className="calendar-panel">
        <header className="calendar-head">
          <div>
            <span className="eyebrow">AGENDA LOCAL</span>
            <h2>Calendario</h2>
            <p>{events.length} eventos · avisos por voz y notificación</p>
          </div>
          <div className="calendar-head-actions">
            <button type="button" onClick={resetForm}>
              Nuevo
            </button>
            <button type="button" onClick={onClose} aria-label="Cerrar calendario">
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="calendar-layout">
          <div className="calendar-list">
            {events.length === 0 ? (
              <p className="calendar-empty">No hay eventos. Crea uno con “Nuevo”.</p>
            ) : (
              events.map((event) => (
                <button
                  type="button"
                  key={event.id}
                  className={`calendar-event ${editingId === event.id ? "is-selected" : ""}`}
                  onClick={() => editEvent(event)}
                >
                  <span className="calendar-event-date">{formatEventDate(event.start)}</span>
                  <strong>{event.title}</strong>
                  <small>
                    Aviso {event.alertMinutes} min antes
                    {event.location ? ` · ${event.location}` : ""}
                  </small>
                  {event.notifiedAt ? <i>AVISADO</i> : null}
                </button>
              ))
            )}
          </div>

          <div className="calendar-form">
            <span className="eyebrow">{editingId ? "EDITAR EVENTO" : "NUEVO EVENTO"}</span>
            <label>
              Título
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="Reunión, cita, recordatorio…"
              />
            </label>
            <label>
              Inicio
              <input
                type="datetime-local"
                value={draft.start}
                onChange={(event) => setDraft({ ...draft, start: event.target.value })}
              />
            </label>
            <label>
              Fin (opcional)
              <input
                type="datetime-local"
                value={draft.end}
                onChange={(event) => setDraft({ ...draft, end: event.target.value })}
              />
            </label>
            <label>
              Avisar antes (minutos)
              <input
                type="number"
                min="0"
                max="10080"
                value={draft.alertMinutes}
                onChange={(event) => setDraft({ ...draft, alertMinutes: event.target.value })}
              />
            </label>
            <label>
              Lugar
              <input
                value={draft.location}
                onChange={(event) => setDraft({ ...draft, location: event.target.value })}
                placeholder="Opcional"
              />
            </label>
            <label>
              Notas
              <textarea
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                rows={4}
                placeholder="Opcional"
              />
            </label>

            {error ? <p className="calendar-error">{error}</p> : null}

            <div className="calendar-form-actions">
              <button type="button" className="primary" onClick={() => void save()} disabled={saving}>
                {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear evento"}
              </button>
              {editingId ? (
                <button type="button" className="calendar-delete" onClick={() => void remove()} disabled={saving}>
                  Eliminar
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
