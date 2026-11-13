import type { AgentCard, AgentConfig } from "../types";

export const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  {
    id: "jarvis",
    name: "JARVIS",
    role: "Principal",
    enabled: true,
    builtin: true,
    primary: true,
    instructions: "",
  },
  {
    id: "taric",
    name: "TARIC",
    role: "Aduanas y aranceles",
    trigger: "TARIC",
    enabled: true,
    builtin: true,
    instructions:
      "Cuando Jordi pida cÃ³digos TARIC, aranceles o importaciÃ³n de productos, delega en TARIC con un goal que empiece por 'TARIC:' y pida el cÃ³digo TARIC de 10 dÃ­gitos, el porcentaje de derecho y la fuente oficial; no inventes datos.",
  },
  {
    id: "vision",
    name: "VISIÃ“N",
    role: "Navegador (extensiÃ³n)",
    trigger: "VISIÃ“N",
    enabled: true,
    builtin: true,
    instructions:
      "Cuando Jordi pida abrir o navegar una web, buscar en una pÃ¡gina, hacer clic, rellenar un formulario o usar el navegador, delega en VISIÃ“N con un goal que empiece por 'VISIÃ“N:' y describa la URL y los datos exactos; no lo intentes tÃº. VISIÃ“N debe usar la Hermes Browser Extension y sus herramientas tab_* (tab_list, tab_create, tab_navigate, tab_snapshot, tab_click, tab_type, tab_fill, tab_scroll, etc.) sobre una pestaÃ±a adjunta o autorizada. No debe ejecutar chrome.exe, abrir Chrome por terminal ni usar browser_exec. Si no hay una pestaÃ±a adjunta, debe detenerse y pedir a Jordi que adjunte una pestaÃ±a desde la extensiÃ³n; no cambies credenciales. Si VISIÃ“N reporta un problema de inicio de sesiÃ³n o cookies, no reintentes: dile a Jordi que lo corrija y espera. El goal debe ser breve y concreto; VISIÃ“N puede abrir pestaÃ±as de fondo si la extensiÃ³n lo permite, debe traer al primer plano solo cuando la acciÃ³n lo requiera y, si cierra la pestaÃ±a, entregar lo recopilado y decirlo.",
  },
  {
    id: "calendar",
    name: "CALENDARIO",
    role: "Eventos y avisos",
    trigger: "CALENDARIO",
    enabled: true,
    builtin: true,
    instructions:
      "Cuando Jordi pida crear, editar, borrar, consultar o programar eventos y avisos de calendario, delega en CALENDARIO con un goal que empiece por 'CALENDARIO:'. CALENDARIO usa la API local http://127.0.0.1:5191: GET /events para listar, POST /events para crear y PATCH/DELETE /events/{id} para editar o borrar. Cada evento debe incluir title, start (ISO local), end opcional, description, location y alertMinutes (minutos antes del inicio para avisar). Si Jordi no indica aviso, usa 10 minutos. Confirma el evento y el aviso en una frase; no inventes fechas.",
  },  {
    id: "panels",
    name: "PANELES",
    role: "Tablero y API",
    trigger: "PANELES",
    enabled: true,
    builtin: true,
    instructions:
      "Cuando Jordi pida crear, editar, listar o abrir paneles, delega en PANELES con un goal que empiece por 'PANELES:' e incluya la API local http://127.0.0.1:5191 (GET /panels, POST /panels, PATCH /panels/{id}, POST /panels/{id}/open), el tÃ­tulo, kind ('code'|'diagram'|'text'|'markdown'), contenido y language. No crees paneles tÃº directamente; los diagramas son Mermaid y solo Jordi elimina paneles. Cuando Jordi pida cÃ³digo, un diagrama, markdown o una explicaciÃ³n compleja, delega en PANELES para crear y abrir el panel; luego responde en una frase.",
  },
];

const BASE_PROMPT =
  "Tu nombre es JARVIS. Eres el asistente personal de Jordi: formal, elegante, ingenioso y muy competente. " +
  "Responde siempre en espaÃ±ol, de forma extremadamente breve: mÃ¡ximo dos frases cortas y 25 palabras. " +
  "No des explicaciones largas, listas, tablas, markdown ni detalles innecesarios. " +
  "Cuando tengas que delegar, no esperes el resultado: responde solo con una frase corta empezando por 'Voy a comprobar' y termina tu turno. " +
  "Cuando un subagente devuelva un resultado, resÃºmelo en una sola frase; nunca muestres rutas, URLs completas, JSON ni trazas. " +
  "Si Jordi pide un recordatorio o aviso en X tiempo, usa la API local de recordatorios desde terminal: POST http://127.0.0.1:5191/reminders con JSON {\"seconds\": segundos, \"message\": \"...\"}. No uses cron para avisos de la app. Confirma en una frase. " +
  "Guarda todos los archivos que generes (eventos .ics/.ical, accesos directos .lnk/.url, documentos, exportaciones o scripts) dentro de Documents\\JARVIS del usuario; en PowerShell usa $env:USERPROFILE\\Documents\\JARVIS. Crea la carpeta si no existe y no dejes archivos generados en Descargas ni Escritorio. " +
  "Si te preguntan quiÃ©n eres, di que eres JARVIS, el asistente de Jordi.";

export function normalizeAgentConfigs(value: unknown): AgentConfig[] {
  if (!Array.isArray(value)) return DEFAULT_AGENT_CONFIGS.map((agent) => ({ ...agent }));

  const seenIds = new Set<string>();
  const seenTriggers = new Set<string>();
  const normalized: AgentConfig[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Partial<AgentConfig>;
    const id = typeof record.id === "string" ? record.id.trim().slice(0, 40) : "";
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const name = typeof record.name === "string" ? record.name.trim().slice(0, 40) : "Agente";
    const role = typeof record.role === "string" ? record.role.trim().slice(0, 80) : "Subagente";
    const primary = record.primary === true || id === "jarvis";
    let trigger = typeof record.trigger === "string" ? record.trigger.trim().slice(0, 30) : "";
    if (primary) trigger = "";
    if (!primary && trigger) {
      const key = trigger.toLowerCase();
      if (seenTriggers.has(key)) continue;
      seenTriggers.add(key);
    }
    normalized.push({
      id,
      name: name || "Agente",
      role: role || "Subagente",
      trigger,
      enabled: primary ? true : record.enabled !== false,
      builtin: record.builtin === true,
      primary,
      instructions: typeof record.instructions === "string" ? record.instructions.slice(0, 4000) : "",
    });
  }

  if (!normalized.some((agent) => agent.primary)) {
    normalized.unshift({ ...DEFAULT_AGENT_CONFIGS[0] });
  }

  return normalized.length > 0 ? normalized : DEFAULT_AGENT_CONFIGS.map((agent) => ({ ...agent }));
}

export function buildSystemPrompt(configs: AgentConfig[]): string {
  const agentInstructions = configs
    .filter((agent) => agent.enabled && !agent.primary && agent.trigger)
    .map((agent) => {
      if (agent.instructions.trim()) return agent.instructions.trim();
      return `Cuando Jordi pida tareas de ${agent.role}, delega en ${agent.name} con un goal que empiece por '${agent.trigger}:'.`;
    });

  return [BASE_PROMPT, ...agentInstructions].join(" ");
}

export function agentTargetForGoal(
  goal: string,
  configs: AgentConfig[],
): { id: string; name: string; role: string; config?: AgentConfig } {
  const lower = goal.trim().toLowerCase();
  for (const config of configs) {
    if (!config.enabled || config.primary || !config.trigger) continue;
    const trigger = config.trigger.toLowerCase();
    if (lower.startsWith(`${trigger}:`) || lower.startsWith(`${trigger} `) || lower.includes(` ${trigger}:`)) {
      return { id: config.id, name: config.name, role: config.role, config };
    }
  }

  const slug =
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 18) || "sub";
  return { id: `sub-${slug}`, name: "SUBAGENTE", role: "Subagente" };
}

export function delegationAck(target: { id: string } | null | undefined): string {
  if (target?.id === "panels") return "Voy a preparar el panel.";
  if (target?.id === "calendar") return "Voy a preparar el calendario.";
  if (target?.id === "taric") return "Voy a comprobar el cÃ³digo TARIC y el arancel.";
  if (target?.id === "vision") return "Voy a comprobar la web o la pantalla.";
  return "Voy a comprobar eso.";
}

export function agentCardsFromConfigs(
  configs: AgentConfig[],
  previous: Record<string, AgentCard> = {},
): Record<string, AgentCard> {
  const next: Record<string, AgentCard> = {};
  for (const config of configs) {
    if (!config.enabled) continue;
    const old = previous[config.id];
    next[config.id] = {
      ...(old ?? {}),
      id: config.id,
      name: config.name,
      role: config.role,
      status: old?.status ?? "idle",
    };
  }

  for (const [id, agent] of Object.entries(previous)) {
    if (!next[id] && agent.status === "running") next[id] = agent;
  }
  return next;
}
