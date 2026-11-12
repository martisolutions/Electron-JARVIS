const base = process.env.HERMES_URL ?? "http://127.0.0.1:8643/v1";
const key = process.env.HERMES_KEY;
const input = process.argv[2] ?? "Di solo: hola.";
const sessionId = process.env.HERMES_SESSION ?? `jarvis-event-test-${Date.now()}`;

if (!key) {
  console.error("HERMES_KEY is required");
  process.exit(1);
}

const startedResponse = await fetch(`${base}/runs`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    input,
    session_id: sessionId,
    instructions:
      "Eres JARVIS. Responde en español, breve. Si la tarea requiere TARIC, delega en un subagente cuyo goal empiece por TARIC.",
  }),
});

const raw = await startedResponse.text();
console.log("[start]", startedResponse.status, raw.slice(0, 600));
let started;
try {
  started = JSON.parse(raw);
} catch {
  process.exit(2);
}
const runId = started.run_id ?? started.id;
if (!runId) {
  console.error("No run_id in response");
  process.exit(3);
}

const eventsResponse = await fetch(`${base}/runs/${runId}/events`, {
  headers: {
    Authorization: `Bearer ${key}`,
    Accept: "text/event-stream",
  },
});

console.log("[events]", eventsResponse.status, eventsResponse.headers.get("content-type"));
const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of eventsResponse.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let boundary = buffer.indexOf("\n\n");
  while (boundary >= 0) {
    const frame = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    boundary = buffer.indexOf("\n\n");
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        const compact = { ...event, timestamp: undefined };
        console.log(
          `[event] seq=${event.seq} ${event.event} ${JSON.stringify(compact).slice(0, 900)}`,
        );
      } catch {
        /* ignore */
      }
    }
  }
}
console.log("[done]", runId, "session", sessionId);
