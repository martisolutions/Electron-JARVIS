export type TranscriptLine = {
  time?: string;
  role: string;
  text: string;
};

export const TRANSCRIPT_ROLE_LABEL: Record<string, string> = {
  user: "Instrucción",
  assistant: "Agente",
  tool: "Herramienta",
  result: "Resultado",
  think: "Razonamiento",
  start: "Inicio",
  end: "Fin",
  final: "Final",
  system: "Sistema",
};

export function parseTranscript(text: string): TranscriptLine[] {
  const parsed: TranscriptLine[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(\d{1,2}:\d{2}:\d{2})\s+([a-z]+)\s*\|\s*(.*)$/i.exec(line.trimEnd());
    if (!match) continue;
    parsed.push({ time: match[1], role: match[2].toLowerCase(), text: match[3] });
  }
  return parsed.slice(-500);
}
