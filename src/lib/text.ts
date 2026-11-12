export function extractMessageText(message: unknown): string {
  if (message === null || message === undefined) return "";
  if (typeof message === "string") return message;
  if (Array.isArray(message)) return message.map(extractBlock).join("");
  if (typeof message === "object") {
    const record = message as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    if (Array.isArray(record.content)) return record.content.map(extractBlock).join("");
    if (record.message) return extractMessageText(record.message);
  }
  return "";
}

function extractBlock(block: unknown): string {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object") return "";
  const record = block as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  return "";
}

export function sanitizeForSpeech(text: string): string {
  let value = text;

  value = value.replace(/\[\[tts:text\]\]([\s\S]*?)\[\[\/tts:text\]\]/gi, "$1");
  value = value.replace(/\[\[tts:[^\]]*\]\]/gi, "");
  value = value.replace(/```[\s\S]*?```/g, " ");
  value = value.replace(/`([^`]*)`/g, "$1");
  value = value.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  value = value.replace(/https?:\/\/\S+/gi, "");
  value = value.replace(/<\/?[a-z][^>]*>/gi, "");
  value = value.replace(/[*_>#~|]+/g, " ");
  value = value.replace(/^\s*[-+*]\s+/gm, "");
  value = value.replace(/\s+/g, " ").trim();

  if (value.length > 3500) {
    const cut = value.slice(0, 3500);
    const lastStop = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
    value = lastStop > 2400 ? cut.slice(0, lastStop + 1) : `${cut}…`;
  }

  return value;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Error inesperado.";
}

export function friendlyError(message: string): string {
  if (/api key id used as api key|invalid_api_key/i.test(message)) {
    return "La API key de ElevenLabs no es válida. Usa el secreto completo que empieza por sk_ (no el ID de la key).";
  }
  if (/no se pudo conectar con (hermes|jarvis)|failed to fetch|networkerror|load failed/i.test(message)) {
    return "No se pudo conectar con JARVIS. Verifica que Hermes local esté activo en http://127.0.0.1:8643/v1.";
  }
  if (/(hermes|jarvis) respondió 404|not found/i.test(message)) {
    return "JARVIS no encontró el endpoint. La URL debe terminar en /v1 (http://127.0.0.1:8643/v1).";
  }
  if (/api key de (hermes|jarvis)|api_server_key/i.test(message)) {
    return "La API key de JARVIS (Hermes) no es válida. Debe coincidir con platforms.api_server.extra.key.";
  }
  if (/elevenlabs/i.test(message)) return message;
  return message;
}
