import { useEffect, useMemo, useState } from "react";
import type { CalendarEvent } from "../types";
import { CalendarIcon, CloseIcon, PlusIcon, TrashIcon } from "./Icons";

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

type EditorState = {
  id: string | null;
  draft: Draft;
};

const DAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB", "DOM"];
const SLOT_MINUTES = 30;
const SLOT_HEIGHT = 34;

function getBridge(): CalendarBridge | undefined {
  return (window as unknown as { jarvisDesktop?: CalendarBridge }).jarvisDesktop;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy;
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function toInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromInputValue(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function timeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function eventTime(event: CalendarEvent): string {
  const start = new Date(event.start);
  const end = new Date(event.end);
  return `${timeLabel(start)} - ${timeLabel(end)}`;
}

function buildDraft(start: Date): Draft {
  const end = new Date(start.getTime() + 60 * 60_000);
  return {
    title: "",
    start: toInputValue(start),
    end: toInputValue(end),
    description: "",
    location: "",
    alertMinutes: "10",
  };
}

function eventDraft(event: CalendarEvent): Draft {
  return {
    title: event.title,
    start: toInputValue(new Date(event.start)),
    end: toInputValue(new Date(event.end)),
    description: event.description ?? "",
    location: event.location ?? "",
    alertMinutes: String(event.alertMinutes ?? 0),
  };
}

async function readEvents(): Promise<CalendarEvent[]> {
  const bridge = getBridge();
  if (bridge?.listCalendarEvents) {
    const state = await bridge.listCalendarEvents();
    return Array.isArray(state?.events) ? state.events : [];
  }
  const response = await fetch("http://127.0.0.1:5191/events");
  if (!response.ok) throw new Error("No se pudo cargar el calendario.");
  const state = (await response.json()) as { events?: CalendarEvent[] };
  return Array.isArray(state.events) ? state.events : [];
}

export function CalendarScreen() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const today = useMemo(() => new Date(), []);
  const weekStart = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const slots = useMemo(() => Array.from({ length: (24 * 60) / SLOT_MINUTES }, (_, index) => index), []);

  useEffect(() => {
    let cancelled = false;
    void readEvents()
      .then((next) => {
        if (!cancelled) setEvents(next);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar el calendario.");
      });

    const unsubscribe = getBridge()?.onCalendarChanged?.((state) => {
      if (!cancelled) setEvents(Array.isArray(state?.events) ? state.events : []);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const weekEvents = useMemo(() => {
    const from = weekStart.getTime();
    const to = addDays(weekStart, 7).getTime();
    return events.filter((event) => {
      const at = new Date(event.start).getTime();
      return Number.isFinite(at) && at >= from && at < to;
    });
  }, [events, weekStart]);

  function openNew(start?: Date): void {
    const fallback = new Date();
    fallback.setMinutes(Math.ceil((fallback.getMinutes() + 1) / SLOT_MINUTES) * SLOT_MINUTES, 0, 0);
    const initial = start ?? (weekOffset === 0 ? fallback : new Date(weekStart.getTime() + 9 * 60 * 60_000));
    setError("");
    setEditor({ id: null, draft: buildDraft(initial) });
  }

  function openEvent(event: CalendarEvent): void {
    setError("");
    setEditor({ id: event.id, draft: eventDraft(event) });
  }

  function updateDraft(patch: Partial<Draft>): void {
    setEditor((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  }

  async function saveEvent(): Promise<void> {
    if (!editor) return;
    const input: Partial<CalendarEvent> = {
      title: editor.draft.title.trim(),
      start: fromInputValue(editor.draft.start),
      end: editor.draft.end ? fromInputValue(editor.draft.end) : undefined,
      description: editor.draft.description.trim(),
      location: editor.draft.location.trim(),
      alertMinutes: Math.max(0, Number(editor.draft.alertMinutes) || 0),
    };
    if (!input.title || !input.start) {
      setError("Indica al menos título y fecha de inicio.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const bridge = getBridge();
      if (editor.id && bridge?.updateCalendarEvent) await bridge.updateCalendarEvent(editor.id, input);
      else if (bridge?.createCalendarEvent) await bridge.createCalendarEvent(input);
      else {
        const response = await fetch(`http://127.0.0.1:5191${editor.id ? `/events/${editor.id}` : "/new-event"}`, {
          method: editor.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        if (!response.ok) throw new Error("No se pudo guardar el evento.");
      }
      setEditor(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el evento.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(): Promise<void> {
    if (!editor?.id || !window.confirm("¿Eliminar este evento?")) return;
    setSaving(true);
    setError("");
    try {
      const bridge = getBridge();
      if (bridge?.deleteCalendarEvent) await bridge.deleteCalendarEvent(editor.id);
      else {
        const response = await fetch("http://127.0.0.1:5191/delete-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editor.id }),
        });
        if (!response.ok) throw new Error("No se pudo eliminar el evento.");
      }
      setEditor(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el evento.");
    } finally {
      setSaving(false);
    }
  }

  function openSlot(day: Date, clientY: number, target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const minuteOfDay = Math.max(0, Math.min(23 * 60 + 30, Math.floor((clientY - rect.top) / SLOT_HEIGHT) * SLOT_MINUTES));
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minuteOfDay / 60), minuteOfDay % 60);
    openNew(start);
  }

  return (
    <section className="calendar-screen" aria-label="Calendario semanal">
      <header className="calendar-screen-head">
        <div className="calendar-title">
          <span className="eyebrow">AGENDA // LOCAL WEEK</span>
          <h2>Calendario</h2>
          <p>{weekEvents.length} eventos esta semana · avisos por voz y notificación</p>
        </div>
        <div className="calendar-screen-actions">
          <div className="calendar-week-nav">
            <button type="button" onClick={() => setWeekOffset((value) => value - 1)} aria-label="Semana anterior">‹</button>
            <button type="button" className="week-today" onClick={() => setWeekOffset(0)}>HOY</button>
            <button type="button" onClick={() => setWeekOffset((value) => value + 1)} aria-label="Semana siguiente">›</button>
          </div>
          <button type="button" className="calendar-new-btn" onClick={() => openNew()}>
            <PlusIcon />
            Nuevo evento
          </button>
        </div>
      </header>

      <div className="calendar-week-strip">
        <div className="week-strip-label">
          <CalendarIcon />
          <span>
            {days[0].toLocaleDateString("es-ES", { day: "2-digit", month: "short" })} —{" "}
            {days[6].toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
          </span>
        </div>
        <div className="week-strip-hint">Doble clic en una franja para crear</div>
      </div>

      <div className="calendar-week-scroll">
        <div className="calendar-week-grid">
          <div className="week-corner" />
          {days.map((day, index) => {
            const isToday = dateKey(day) === dateKey(today);
            return (
              <div key={dateKey(day)} className={`week-day-head ${isToday ? "is-today" : ""}`}>
                <span>{DAY_LABELS[index]}</span>
                <strong>{day.getDate()}</strong>
              </div>
            );
          })}

          <div className="week-time-col">
            {slots.map((slot) => {
              const minutes = slot * SLOT_MINUTES;
              return (
                <div key={slot} className={minutes % 60 === 0 ? "week-time is-hour" : "week-time"}>
                  {pad(Math.floor(minutes / 60))}:{pad(minutes % 60)}
                </div>
              );
            })}
          </div>

          {days.map((day) => {
            const dayEvents = weekEvents
              .map((event) => {
                const start = new Date(event.start);
                const end = new Date(event.end);
                const sameDay = dateKey(start) === dateKey(day);
                if (!sameDay) return null;
                const startMinutes = start.getHours() * 60 + start.getMinutes();
                const endMinutes = end < start ? 24 * 60 : end.getHours() * 60 + end.getMinutes();
                const top = (startMinutes / SLOT_MINUTES) * SLOT_HEIGHT;
                const height = Math.max(SLOT_HEIGHT, ((Math.max(endMinutes, startMinutes + SLOT_MINUTES) - startMinutes) / SLOT_MINUTES) * SLOT_HEIGHT - 3);
                return { event, top, height };
              })
              .filter((item): item is { event: CalendarEvent; top: number; height: number } => Boolean(item));

            return (
              <div
                key={dateKey(day)}
                className={`week-day-column ${dateKey(day) === dateKey(today) ? "is-today" : ""}`}
                style={{ height: slots.length * SLOT_HEIGHT }}
                onDoubleClick={(event) => {
                  if (event.target === event.currentTarget) openSlot(day, event.clientY, event.currentTarget);
                }}
              >
                {slots.map((slot) => (
                  <div
                    key={slot}
                    className={slot % 2 === 0 ? "week-slot is-hour" : "week-slot"}
                    style={{ height: SLOT_HEIGHT }}
                    onDoubleClick={(event) => openSlot(day, event.clientY, event.currentTarget)}
                  />
                ))}
                {dayEvents.map(({ event, top, height }) => (
                  <button
                    type="button"
                    key={event.id}
                    className={`week-event ${event.notifiedAt ? "is-notified" : ""}`}
                    style={{ top, height }}
                    onClick={(click) => {
                      click.stopPropagation();
                      openEvent(event);
                    }}
                    title={`${event.title} · ${eventTime(event)}`}
                  >
                    <strong>{event.title}</strong>
                    <small>{eventTime(event)}</small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {editor ? (
        <div className="calendar-editor-overlay" role="dialog" aria-modal="true" aria-label="Editor de evento" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditor(null);
        }}>
          <form className="calendar-editor-card" onSubmit={(event) => { event.preventDefault(); void saveEvent(); }}>
            <header className="calendar-editor-head">
              <div>
                <span className="eyebrow">{editor.id ? "EDITAR EVENTO" : "NUEVO EVENTO"}</span>
                <h3>{editor.id ? "Actualizar agenda" : "Añadir a la agenda"}</h3>
              </div>
              <button type="button" onClick={() => setEditor(null)} aria-label="Cerrar editor">
                <CloseIcon />
              </button>
            </header>

            <label>
              Título
              <input value={editor.draft.title} onChange={(event) => updateDraft({ title: event.target.value })} placeholder="Reunión, cita, recordatorio..." autoFocus />
            </label>
            <div className="calendar-editor-row">
              <label>
                Inicio
                <input type="datetime-local" value={editor.draft.start} onChange={(event) => updateDraft({ start: event.target.value })} />
              </label>
              <label>
                Fin
                <input type="datetime-local" value={editor.draft.end} onChange={(event) => updateDraft({ end: event.target.value })} />
              </label>
            </div>
            <div className="calendar-editor-row">
              <label>
                Avisar antes (min)
                <input type="number" min="0" max="10080" value={editor.draft.alertMinutes} onChange={(event) => updateDraft({ alertMinutes: event.target.value })} />
              </label>
              <label>
                Lugar
                <input value={editor.draft.location} onChange={(event) => updateDraft({ location: event.target.value })} placeholder="Opcional" />
              </label>
            </div>
            <label>
              Notas
              <textarea value={editor.draft.description} onChange={(event) => updateDraft({ description: event.target.value })} rows={3} placeholder="Opcional" />
            </label>

            {error ? <p className="calendar-error">{error}</p> : null}

            <div className="calendar-editor-actions">
              {editor.id ? (
                <button type="button" className="calendar-delete" onClick={() => void deleteEvent()} disabled={saving}>
                  <TrashIcon />
                  Eliminar
                </button>
              ) : <span />}
              <button type="button" onClick={() => setEditor(null)}>Cancelar</button>
              <button type="submit" className="primary" disabled={saving}>{saving ? "Guardando..." : editor.id ? "Guardar cambios" : "Crear evento"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
