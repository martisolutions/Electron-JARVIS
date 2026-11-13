const { app, BrowserWindow, ipcMain, session, shell, Notification, dialog } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const PROD_PORT = 5188;

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

function gatewayHealthy(port = 8643) {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/health`, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

function powershellPath() {
  return path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

const HERMES_DETECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$candidates = @(
  (Join-Path $env:LOCALAPPDATA 'hermes\config.yaml'),
  (Join-Path $env:APPDATA 'hermes\config.yaml'),
  (Join-Path $env:USERPROFILE '.hermes\config.yaml')
)
$cfg = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $cfg) {
  [pscustomobject]@{ found = $false; error = 'No se encontrÃ³ config.yaml de Hermes.' } | ConvertTo-Json -Compress
  exit 0
}
$lines = Get-Content -LiteralPath $cfg
$platforms = New-Object System.Collections.Generic.List[string]
$inPlatforms = $false
foreach ($line in $lines) {
  if ($line -match '^platforms:\s*$') { $inPlatforms = $true; continue }
  if ($inPlatforms) {
    if ($line -match '^\S') { break }
    $platforms.Add($line)
  }
}
$api = New-Object System.Collections.Generic.List[string]
$inApi = $false
foreach ($line in $platforms) {
  if ($line -match '^\s{2}api_server:\s*$') { $inApi = $true; continue }
  if ($inApi) {
    if ($line -match '^\s{2}\S') { break }
    $api.Add($line)
  }
}
if (-not $inApi) {
  [pscustomobject]@{ found = $false; configPath = $cfg; error = 'No se encontrÃ³ platforms.api_server en config.yaml.' } | ConvertTo-Json -Compress
  exit 0
}
function CleanValue([string]$value) {
  $v = ($value -split '\s+#', 2)[0].Trim()
  if ($v.Length -ge 2 -and (($v.StartsWith([char]34) -and $v.EndsWith([char]34)) -or ($v.StartsWith([char]39) -and $v.EndsWith([char]39)))) {
    $v = $v.Substring(1, $v.Length - 2)
  }
  return $v
}
$enabledLine = $api | Where-Object { $_ -match '^\s{4}enabled:\s*(.+)$' } | Select-Object -First 1
$enabled = if ($enabledLine) { CleanValue (($enabledLine -replace '^\s{4}enabled:\s*', '')) } else { '' }
$keyLine = $api | Where-Object { $_ -match '^\s{6}key:\s*(.*)$' } | Select-Object -First 1
$key = if ($keyLine) { CleanValue (($keyLine -replace '^\s{6}key:\s*', '')) } else { '' }
$portLine = $api | Where-Object { $_ -match '^\s{6}port:\s*(.+)$' } | Select-Object -First 1
$port = if ($portLine) { CleanValue (($portLine -replace '^\s{6}port:\s*', '')) } else { '8643' }
if (($key -eq '') -or ($key -match '^\$\{')) {
  $envPath = Join-Path (Split-Path -Parent $cfg) '.env'
  if (Test-Path -LiteralPath $envPath) {
    $envLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*(?:export\s+)?API_SERVER_KEY\s*=' } | Select-Object -First 1
    if ($envLine) { $key = CleanValue (($envLine -split '=', 2)[1]) }
  }
}
if ($key -match '^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$') {
  $key = [Environment]::GetEnvironmentVariable($Matches[1])
}
[pscustomobject]@{
  found = $true
  configPath = $cfg
  enabled = $enabled
  port = $port
  key = $key
  url = ('http://127.0.0.1:' + $port + '/v1')
} | ConvertTo-Json -Compress
`;

async function detectLocalHermes() {
  if (process.platform !== "win32") {
    return { found: false, error: "La detecciÃ³n automÃ¡tica estÃ¡ disponible en Windows." };
  }
  try {
    const { stdout } = await execFileAsync(
      powershellPath(),
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", HERMES_DETECT_SCRIPT],
      { timeout: 15000, windowsHide: true, maxBuffer: 1024 * 64 },
    );
    const payload = JSON.parse(String(stdout).trim());
    if (!payload.found) return payload;
    const port = Number(payload.port) || 8643;
    const enabled = String(payload.enabled).toLowerCase() !== "false";
    const gateway = enabled ? await gatewayHealthy(port) : false;
    return {
      ...payload,
      key: typeof payload.key === "string" ? payload.key.trim() : "",
      port,
      enabled,
      gateway,
      url: `http://127.0.0.1:${port}/v1`,
    };
  } catch (error) {
    return {
      found: false,
      error: `No se pudo leer la configuraciÃ³n de Hermes: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function stopAllHermesAgents() {
  const powershell = powershellPath();
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "Stop-ScheduledTask -TaskName 'Hermes_Gateway'",
    "$c=Get-NetTCPConnection -LocalPort 8643 -State Listen",
    "if ($c) { Stop-Process -Id $c.OwningProcess -Force }",
    "Start-Sleep -Seconds 1",
    "Start-ScheduledTask -TaskName 'Hermes_Gateway'",
  ].join("; ");

  try {
    await execFileAsync(
      powershell,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 20000, windowsHide: true },
    );
  } catch (error) {
    console.log("[stop-all]", error.message);
  }

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await gatewayHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

ipcMain.handle("hermes:stop-all", () => stopAllHermesAgents());
ipcMain.handle("hermes:detect-local", () => detectLocalHermes());
ipcMain.handle("files:pick", async () => {
  const result = await dialog.showOpenDialog({
    title: "Adjuntar archivos a JARVIS",
    properties: ["openFile", "multiSelections"],
  });
  return result.canceled ? [] : result.filePaths;
});


ipcMain.handle("hermes:read-log", async (_event, filePath) => {
  const home = process.env.LOCALAPPDATA;
  if (!home || typeof filePath !== "string") return "";
  const roots = [
    path.join(home, "hermes", "cache", "delegation"),
    path.join(home, "hermes", "logs"),
  ].map((root) => path.resolve(root) + path.sep);
  const resolved = path.resolve(filePath);
  if (!roots.some((root) => resolved.startsWith(root))) return "";
  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) return "";
    const start = Math.max(0, stat.size - 32768);
    const length = stat.size - start;
    if (length <= 0) return "";
    const handle = await fs.promises.open(resolved, "r");
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    await handle.close();
    return buffer.toString("utf8");
  } catch {
    return "";
  }
});

if (process.env.JARVIS_FAKE_MIC) {
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-file-for-fake-audio-capture", process.env.JARVIS_FAKE_MIC);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function startStaticServer(root) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      const urlPath = decodeURIComponent((request.url || "/").split("?")[0]);
      let filePath = path.join(root, urlPath === "/" ? "index.html" : urlPath);

      if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end("");
        return;
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(root, "index.html");
      }

      fs.readFile(filePath, (error, data) => {
        if (error) {
          response.writeHead(500);
          response.end("");
          return;
        }
        response.writeHead(200, {
          "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
          "Cache-Control": "no-cache",
        });
        response.end(data);
      });
    });

    server.listen(PROD_PORT, "127.0.0.1", () => resolve(server));
  });
}

const PANEL_API_PORT = 5191;
const PANEL_KINDS = new Set(["code", "diagram", "text", "markdown"]);

const reminders = new Map();
let reminderSeq = 0;

function scheduleReminder(input) {
  const rawSeconds = Number(
    input?.seconds ?? input?.delay_seconds ?? (input?.minutes !== undefined ? Number(input.minutes) * 60 : NaN),
  );
  if (!Number.isFinite(rawSeconds) || rawSeconds <= 0) {
    throw new Error("Indica seconds (o minutes) mayores que cero.");
  }
  const seconds = Math.min(86_400, Math.max(1, rawSeconds));
  const message = sanitizePanelText(input?.message ?? input?.text ?? "", 800).trim();
  if (!message) throw new Error("Falta el mensaje del recordatorio.");

  const id = `rem-${Date.now().toString(36)}-${++reminderSeq}`;
  const dueAt = Date.now() + seconds * 1000;
  const timer = setTimeout(() => {
    reminders.delete(id);
    const payload = { id, message, dueAt };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("reminders:fire", payload);
    }
    try {
      new Notification({ title: "JARVIS", body: message }).show();
    } catch {
      /* OS notifications are best-effort */
    }
  }, seconds * 1000);

  reminders.set(id, { id, message, dueAt, timer });
  return { id, dueAt, seconds };
}

let panels = [];
let openPanelIds = new Set();
let panelStoreFile = "";
let panelApiServer = null;

function sanitizePanelText(value, max) {
  return String(value ?? "").slice(0, max);
}

function panelSnapshot() {
  return { panels, openIds: [...openPanelIds] };
}

function normalizeStoredPanel(value) {
  if (!value || typeof value !== "object") return null;
  const id = sanitizePanelText(value.id, 80).trim();
  if (!id) return null;
  const kind = PANEL_KINDS.has(value.kind) ? value.kind : "text";
  return {
    id,
    title: sanitizePanelText(value.title || "Panel", 120).trim() || "Panel",
    kind,
    content: sanitizePanelText(value.content || "", 200000),
    language: sanitizePanelText(value.language || "", 40).trim(),
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now(),
    createdBy: value.createdBy === "user" ? "user" : "jarvis",
  };
}

function initPanelStore() {
  panelStoreFile = path.join(app.getPath("userData"), "panels.json");
  try {
    const raw = JSON.parse(fs.readFileSync(panelStoreFile, "utf8"));
    panels = Array.isArray(raw.panels)
      ? raw.panels.map(normalizeStoredPanel).filter(Boolean)
      : [];
    const ids = new Set(panels.map((panel) => panel.id));
    openPanelIds = new Set(
      Array.isArray(raw.openIds) ? raw.openIds.filter((id) => ids.has(id)) : [],
    );
  } catch {
    panels = [];
    openPanelIds = new Set();
  }
}

function savePanelStore() {
  try {
    fs.mkdirSync(path.dirname(panelStoreFile), { recursive: true });
    fs.writeFileSync(panelStoreFile, JSON.stringify(panelSnapshot(), null, 2), "utf8");
  } catch (error) {
    console.log("[panels-save]", error);
  }
}

function broadcastPanels() {
  const state = panelSnapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("panels:changed", state);
  }
}

function normalizePanelInput(input, existing = {}) {
  const title = sanitizePanelText(input.title ?? existing.title ?? "Panel", 120).trim() || "Panel";
  const kind = PANEL_KINDS.has(input.kind)
    ? input.kind
    : PANEL_KINDS.has(existing.kind)
      ? existing.kind
      : "text";
  const content = sanitizePanelText(input.content ?? existing.content ?? "", 200000);
  const language = sanitizePanelText(input.language ?? existing.language ?? "", 40).trim();
  return { title, kind, content, language };
}

function createPanel(input, createdBy = "jarvis") {
  const now = Date.now();
  const data = normalizePanelInput(input || {});
  const panel = {
    id: `panel-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    ...data,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
  panels = [panel, ...panels];
  savePanelStore();
  broadcastPanels();
  return panel;
}

function updatePanelById(id, input) {
  const index = panels.findIndex((panel) => panel.id === id);
  if (index === -1) return null;
  const existing = panels[index];
  const data = normalizePanelInput(input || {}, existing);
  const panel = { ...existing, ...data, updatedAt: Date.now() };
  panels = panels.map((item, itemIndex) => (itemIndex === index ? panel : item));
  savePanelStore();
  broadcastPanels();
  return panel;
}

function deletePanelById(id) {
  const before = panels.length;
  panels = panels.filter((panel) => panel.id !== id);
  openPanelIds.delete(id);
  if (panels.length === before) return false;
  savePanelStore();
  broadcastPanels();
  return true;
}

function openPanelById(id) {
  const panel = panels.find((item) => item.id === id);
  if (!panel) return null;
  openPanelIds.add(id);
  savePanelStore();
  broadcastPanels();

  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send("panels:open", { id, ...panelSnapshot() });
  }
  return panel;
}

function setPanelOpenState(id, open) {
  if (!panels.some((panel) => panel.id === id)) return false;
  if (open) openPanelIds.add(id);
  else openPanelIds.delete(id);
  savePanelStore();
  broadcastPanels();
  return true;
}

ipcMain.handle("panels:list", () => panelSnapshot());
ipcMain.handle("panels:create", (_event, input) => createPanel(input, "user"));
ipcMain.handle("panels:update", (_event, id, input) => updatePanelById(String(id || ""), input));
ipcMain.handle("panels:delete", (_event, id) => deletePanelById(String(id || "")));
ipcMain.handle("panels:set-open", (_event, id, open) =>
  setPanelOpenState(String(id || ""), Boolean(open)),
);

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) {
        reject(new Error("El cuerpo supera 256 KB."));
        request.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("JSON no vÃ¡lido."));
      }
    });
    request.on("error", reject);
  });
}

function sendPanelJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(payload));
}

function startPanelApi() {
  panelApiServer = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      response.end();
      return;
    }

    if (pathname === "/health" && request.method === "GET") {
      sendPanelJson(response, 200, { ok: true, ...panelSnapshot() });
      return;
    }

    if (pathname === "/reminders" && request.method === "GET") {
      sendPanelJson(response, 200, {
        object: "list",
        reminders: [...reminders.values()].map(({ id, message, dueAt }) => ({ id, message, dueAt })),
      });
      return;
    }

    if (pathname === "/reminders" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendPanelJson(response, 400, { error: "Se esperaba un objeto JSON." });
          return;
        }
        sendPanelJson(response, 201, scheduleReminder(body));
      } catch (error) {
        sendPanelJson(response, 400, { error: error.message || "Recordatorio no vÃ¡lido." });
      }
      return;
    }

    const reminderMatch = /^\/reminders\/([^/]+)$/.exec(pathname);
    if (reminderMatch && request.method === "DELETE") {
      const id = decodeURIComponent(reminderMatch[1]);
      const reminder = reminders.get(id);
      if (!reminder) {
        sendPanelJson(response, 404, { error: "Recordatorio no encontrado." });
        return;
      }
      clearTimeout(reminder.timer);
      reminders.delete(id);
      sendPanelJson(response, 200, { ok: true, id });
      return;
    }

    if (pathname === "/panels" && request.method === "GET") {
      sendPanelJson(response, 200, { object: "list", ...panelSnapshot() });
      return;
    }

    if (pathname === "/panels" && request.method === "POST") {
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendPanelJson(response, 400, { error: "Se esperaba un objeto JSON." });
          return;
        }
        sendPanelJson(response, 201, createPanel(body, "jarvis"));
      } catch (error) {
        sendPanelJson(response, 400, { error: error.message || "Solicitud no vÃ¡lida." });
      }
      return;
    }

    const match = /^\/panels\/([^/]+)(\/open)?$/.exec(pathname);
    if (!match) {
      sendPanelJson(response, 404, { error: "Ruta no encontrada." });
      return;
    }

    const id = decodeURIComponent(match[1]);
    const panel = panels.find((item) => item.id === id);
    if (!panel) {
      sendPanelJson(response, 404, { error: "Panel no encontrado." });
      return;
    }

    if (match[2] && request.method === "POST") {
      openPanelById(id);
      sendPanelJson(response, 200, { panel, ...panelSnapshot() });
      return;
    }

    if (request.method === "GET") {
      sendPanelJson(response, 200, panel);
      return;
    }

    if (request.method === "PATCH") {
      try {
        const body = await readJsonBody(request);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          sendPanelJson(response, 400, { error: "Se esperaba un objeto JSON." });
          return;
        }
        sendPanelJson(response, 200, updatePanelById(id, body));
      } catch (error) {
        sendPanelJson(response, 400, { error: error.message || "Solicitud no vÃ¡lida." });
      }
      return;
    }

    if (request.method === "DELETE") {
      sendPanelJson(response, 405, {
        error: "Solo el usuario puede eliminar paneles desde el tablero.",
      });
      return;
    }

    sendPanelJson(response, 405, { error: "MÃ©todo no permitido." });
  });

  panelApiServer.on("error", (error) => {
    console.log("[panel-api]", error.message);
  });
  panelApiServer.listen(PANEL_API_PORT, "127.0.0.1", () => {
    console.log(`[panel-api] http://127.0.0.1:${PANEL_API_PORT}`);
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: "#000000",
    icon: path.join(__dirname, "..", "assets", "jarvis.ico"),
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay:
      process.platform === "win32"
        ? { color: "#000000", symbolColor: "#7fe9ff", height: 36 }
        : false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (DEV_URL) {
    await win.loadURL(`${DEV_URL}${process.env.JARVIS_QUERY ?? ""}`);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const server = await startStaticServer(path.join(__dirname, "..", "dist"));
    app.on("before-quit", () => server.close());
    await win.loadURL(`http://127.0.0.1:${PROD_PORT}/${process.env.JARVIS_QUERY ?? ""}`);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const seedHermesUrl = process.env.JARVIS_HERMES_URL;
  const seedHermesKey = process.env.JARVIS_HERMES_KEY;
  const seedModel = process.env.JARVIS_MODEL;
  const seedElevenKey = process.env.JARVIS_ELEVENLABS_KEY;
  const seedVoice = process.env.JARVIS_VOICE_ID;
  const seedSessionId = process.env.JARVIS_SESSION_ID;

  if (seedHermesUrl || seedHermesKey || seedElevenKey || seedSessionId) {
    try {
      const changed = await win.webContents.executeJavaScript(`
        (() => {
          const key = 'jarvis.settings.v2';
          let current = {};
          try { current = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
          const hermesUrl = ${JSON.stringify(seedHermesUrl ?? "")};
          const hermesKey = ${JSON.stringify(seedHermesKey ?? "")};
          const model = ${JSON.stringify(seedModel ?? "")};
          const elevenLabsKey = ${JSON.stringify(seedElevenKey ?? "")};
          const voiceId = ${JSON.stringify(seedVoice ?? "")};
          const sessionId = ${JSON.stringify(seedSessionId ?? "")};
          const next = {
            ...current,
            hermesUrl: hermesUrl || current.hermesUrl || 'http://127.0.0.1:8643/v1',
            hermesKey: hermesKey || current.hermesKey || '',
            model: model || current.model || 'hermes-agent',
            sessionId: sessionId || current.sessionId || 'jarvis-core',
            elevenLabsKey: elevenLabsKey || current.elevenLabsKey || '',
            voiceId: voiceId || current.voiceId || 'bk9pYhUWGgt4Nf0ivB3g',
            elevenLabsModel: current.elevenLabsModel || 'eleven_multilingual_v2',
            autoSpeak: true,
          };
          if (
            current.hermesUrl === next.hermesUrl &&
            current.hermesKey === next.hermesKey &&
            current.model === next.model &&
            current.sessionId === next.sessionId &&
            current.elevenLabsKey === next.elevenLabsKey &&
            current.voiceId === next.voiceId &&
            current.autoSpeak === true
          ) {
            return false;
          }
          localStorage.setItem(key, JSON.stringify(next));
          return true;
        })()
      `);
      if (changed) {
        console.log("[seed] Hermes configured, reloading");
        win.reload();
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    } catch (error) {
      console.log("[seed-error]", error);
    }
  }

  win.webContents.on("console-message", (_event, level, message) => {
    if (process.env.JARVIS_CAPTURE || DEV_URL) console.log(`[renderer:${level}]`, message);
  });

  if (process.env.JARVIS_CAPTURE) {
    setTimeout(async () => {
      try {
        if (process.env.JARVIS_CAPTURE_CLICK) {
          await win.webContents.executeJavaScript(
            `document.querySelector(${JSON.stringify(process.env.JARVIS_CAPTURE_CLICK)})?.click()`,
          );
          await new Promise((resolve) => setTimeout(resolve, 700));
        }

        if (process.env.JARVIS_CAPTURE_SEND) {
          await win.webContents.executeJavaScript(`
            (() => {
              const input = document.querySelector('.composer-input');
              const form = document.querySelector('.composer');
              if (!input || !form) return false;
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(input, ${JSON.stringify(process.env.JARVIS_CAPTURE_SEND)});
              input.dispatchEvent(new Event('input', { bubbles: true }));
              form.requestSubmit();
              return true;
            })()
          `);
          await new Promise((resolve) => setTimeout(resolve, 9000));
        }

        if (process.env.JARVIS_CAPTURE_ACTION) {
          const action = process.env.JARVIS_CAPTURE_ACTION;
          const holdMs = Number(process.env.JARVIS_ACTION_HOLD_MS || 2500);
          const afterMs = Number(process.env.JARVIS_ACTION_WAIT || 9000);
          const result = await win.webContents.executeJavaScript(`
            (async () => {
              const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
              const btn = document.querySelector('.round-btn.mic');
              const key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true }));
              const pointer = (type, buttons) => btn?.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, isPrimary: true, button: 0, buttons, pointerType: 'mouse' }));
              const action = ${JSON.stringify(action)};
              let during = null;
              const snapshot = () => ({
                phase: window.__jarvisDebug?.phase(),
                mic: btn?.className,
                pill: document.querySelector('.recording-pill')?.textContent ?? '',
              });
              if (action === 'hold-space') {
                key('keydown');
                await wait(900);
                during = snapshot();
                await wait(Math.max(0, ${holdMs} - 900));
                key('keyup');
                await wait(${afterMs});
              } else if (action === 'hold-mic') {
                pointer('pointerdown', 1);
                await wait(900);
                during = snapshot();
                await wait(Math.max(0, ${holdMs} - 900));
                pointer('pointerup', 0);
                await wait(${afterMs});
              } else if (action === 'click-mic-start') {
                pointer('pointerdown', 1);
                await wait(80);
                pointer('pointerup', 0);
                await wait(700);
                during = snapshot();
              } else if (action === 'click-mic-stop') {
                pointer('pointerdown', 1);
                await wait(80);
                pointer('pointerup', 0);
                await wait(700);
                pointer('pointerdown', 1);
                await wait(80);
                pointer('pointerup', 0);
                await wait(${afterMs});
              }
              return {
                during,
                phase: window.__jarvisDebug?.phase(),
                messages: window.__jarvisDebug?.messages()?.map((m) => m.role + ': ' + m.text),
                mic: btn?.className,
                pill: document.querySelector('.recording-pill')?.textContent ?? '',
              };
            })()
          `);
          console.log("[action]", JSON.stringify(result));
        }

        if (process.env.JARVIS_CAPTURE_REAL_CLICK) {
          const selector = JSON.stringify(process.env.JARVIS_CAPTURE_REAL_CLICK);
          const rect = await win.webContents.executeJavaScript(
            `(() => {
              const el = document.querySelector(${selector});
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
            })()`,
          );
          if (rect) {
            win.webContents.sendInputEvent({ type: "mouseMove", x: rect.x, y: rect.y });
            win.webContents.sendInputEvent({ type: "mouseDown", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
            win.webContents.sendInputEvent({ type: "mouseUp", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
            console.log("[real-click]", selector, rect);
          } else {
            console.log("[real-click] not found", selector);
          }
          await new Promise((resolve) => setTimeout(resolve, 900));
        }

        const image = await win.webContents.capturePage();
        fs.writeFileSync(process.env.JARVIS_CAPTURE, image.toPNG());
        console.log("[capture]", process.env.JARVIS_CAPTURE);
        const state = await win.webContents.executeJavaScript(
          "JSON.stringify({ status: document.querySelector('.status')?.textContent, orb: document.querySelector('.app')?.dataset.state, gate: Boolean(document.querySelector('.gate')), caption: document.querySelector('.caption p')?.textContent ?? '', notice: document.querySelector('.notice')?.textContent ?? '', detail: document.querySelector('.status')?.getAttribute('title') ?? '', gateText: document.querySelector('.gate p')?.textContent ?? '', welcome: sessionStorage.getItem('jarvis.welcomePlayed') ?? '', phase: window.__jarvisDebug?.phase(), mic: document.querySelector('.mic')?.className, pill: document.querySelector('.recording-pill')?.textContent ?? '', messages: (window.__jarvisDebug?.messages() ?? []).slice(-6).map((m) => m.role + ': ' + m.text), settingsOpen: Boolean(document.querySelector('.settings')), agents: Object.values(window.__jarvisDebug?.agents?.() ?? {}).map((a) => a.name + ':' + a.status + ':' + (a.costUsd ?? '') + ':' + (a.lastOperation ?? '')), agentLog: (window.__jarvisDebug?.agentLog?.() ?? []).slice(-6).map((e) => e.text) })",
        );
        console.log("[state]", state);
      } catch (error) {
        console.log("[capture-error]", error);
      }
      app.quit();
    }, Number(process.env.JARVIS_CAPTURE_DELAY || 9000));
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send("jarvis:second-instance");
    }
  });

  app.whenReady().then(async () => {
    const ses = session.defaultSession;

    initPanelStore();
    startPanelApi();
    app.on("before-quit", () => {
      if (panelApiServer) panelApiServer.close();
    });

    ses.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "media" || permission === "microphone" || permission === "audioCapture");
    });

    ses.setPermissionCheckHandler((_webContents, permission) => {
      return permission === "media" || permission === "microphone" || permission === "audioCapture";
    });

    await createWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) await createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

