import { useState } from "react";
import { HermesClient } from "../lib/hermes";
import { useStore } from "../store";
import type { AgentConfig } from "../types";

type Detection = {
  model: string;
  toolsets: string[];
  agents: AgentConfig[];
};

function detectAgents(configs: AgentConfig[], toolsets: string[]): AgentConfig[] {
  const available = new Set(toolsets);
  if (available.size === 0) return configs.map((agent) => ({ ...agent }));
  return configs.map((agent) => {
    if (agent.id === "vision") {
      return { ...agent, enabled: available.has("browser") || available.has("vision") };
    }
    if (agent.id === "taric") {
      return { ...agent, enabled: available.has("web") || available.has("browser") };
    }
    if (agent.id === "panels") {
      return { ...agent, enabled: true };
    }
    return { ...agent };
  });
}

export function Onboarding({ onComplete }: { onComplete: () => void }) {
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
  const saveAgentConfigs = useStore((state) => state.saveAgentConfigs);
  const [url, setUrl] = useState(settings.hermesUrl);
  const [key, setKey] = useState(settings.hermesKey);
  const [elevenKey, setElevenKey] = useState(settings.elevenLabsKey);
  const [voiceId, setVoiceId] = useState(settings.voiceId);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  async function testConnection(): Promise<void> {
    setTesting(true);
    setError("");
    setDetection(null);
    try {
      const client = new HermesClient({ ...settings, hermesUrl: url.trim(), hermesKey: key.trim() });
      const [models, toolsets] = await Promise.all([client.listModels(), client.getToolsets()]);
      const model = models.includes(settings.model) ? settings.model : (models[0] ?? "hermes-agent");
      const enabledToolsets = toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name);
      setDetection({
        model,
        toolsets: enabledToolsets,
        agents: detectAgents(settings.agentConfigs, enabledToolsets),
      });
    } catch (connectionError) {
      setError(connectionError instanceof Error ? connectionError.message : "No se pudo conectar.");
    } finally {
      setTesting(false);
    }
  }

  function start(): void {
    if (!detection) return;
    saveAgentConfigs(detection.agents);
    setSettings({
      hermesUrl: url.trim() || settings.hermesUrl,
      hermesKey: key.trim(),
      model: detection.model,
      elevenLabsKey: elevenKey.trim(),
      voiceId: voiceId.trim() || settings.voiceId,
      onboarded: true,
    });
    onComplete();
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Configurar JARVIS">
      <div className="onboarding-card">
        <div className="onboarding-mark">J.A.R.V.I.S.</div>
        <span className="eyebrow">PRIMERA CONFIGURACIÓN</span>
        <h1>Conecta tu Hermes</h1>
        <p className="onboarding-intro">
          Introduce la URL del API server de Hermes. La app comprobará el modelo y las capacidades disponibles
          antes de crear los agentes.
        </p>

        <label>
          URL de Hermes
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://127.0.0.1:8643/v1"
            spellCheck={false}
          />
        </label>
        <label>
          API key de Hermes
          <input
            value={key}
            onChange={(event) => setKey(event.target.value)}
            type="password"
            placeholder="API_SERVER_KEY"
            spellCheck={false}
          />
        </label>

        <div className="onboarding-row">
          <label>
            ElevenLabs (opcional)
            <input
              value={elevenKey}
              onChange={(event) => setElevenKey(event.target.value)}
              type="password"
              placeholder="sk_..."
              spellCheck={false}
            />
          </label>
          <label>
            Voz (opcional)
            <input
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              placeholder="voice_id"
              spellCheck={false}
            />
          </label>
        </div>

        {error ? <p className="onboarding-error">{error}</p> : null}

        {detection ? (
          <div className="onboarding-detection">
            <span className="eyebrow">DETECTADO</span>
            <p>
              Modelo <strong>{detection.model}</strong>
              {detection.toolsets.length > 0
                ? ` · Capacidades: ${detection.toolsets.slice(0, 8).join(", ")}`
                : " · No se pudieron leer las capacidades"}
            </p>
            <div className="onboarding-agents">
              {detection.agents
                .filter((agent) => agent.enabled)
                .map((agent) => (
                  <span key={agent.id} className="onboarding-agent-pill">
                    {agent.name}
                    {agent.trigger ? ` · ${agent.trigger}:` : ""}
                  </span>
                ))}
            </div>
          </div>
        ) : null}

        <div className="onboarding-actions">
          <button type="button" onClick={() => void testConnection()} disabled={testing || !url.trim() || !key.trim()}>
            {testing ? "Comprobando…" : "Probar conexión y detectar"}
          </button>
          <button type="button" className="primary" onClick={start} disabled={!detection}>
            Empezar
          </button>
        </div>
        <p className="onboarding-foot">
          Los agentes son roles configurables. Podrás crear, editar o desactivarlos desde el panel lateral.
        </p>
      </div>
    </div>
  );
}
