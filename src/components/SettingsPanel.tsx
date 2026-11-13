import { useState } from "react";
import { useStore } from "../store";
import type { ConnectionState, OrbVisualState } from "../types";
import { CloseIcon, PowerIcon, SparkIcon } from "./Icons";

type Props = {
  connection: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
  onTestVoice: () => void;
};

type LocalHermes = {
  found: boolean;
  url?: string;
  key?: string;
  port?: number;
  enabled?: boolean;
  gateway?: boolean;
  error?: string;
};

type DetectBridge = {
  jarvisDesktop?: {
    detectHermes?: () => Promise<LocalHermes>;
  };
};

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: "Sin conexión",
  connecting: "Conectando",
  connected: "JARVIS en línea",
  error: "Error de conexión",
};

const ORB_STATES: Array<{ id: OrbVisualState; label: string }> = [
  { id: "idle", label: "IDLE" },
  { id: "thinking", label: "THINKING" },
  { id: "talking", label: "TALKING" },
  { id: "delegated", label: "DELEGATED" },
];

export function SettingsPanel({ connection, onConnect, onDisconnect, onTestVoice }: Props) {
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);

  const [hermesUrl, setHermesUrl] = useState(settings.hermesUrl);
  const [hermesKey, setHermesKey] = useState(settings.hermesKey);
  const [model, setModel] = useState(settings.model);
  const [elevenLabsKey, setElevenLabsKey] = useState(settings.elevenLabsKey);
  const [voiceId, setVoiceId] = useState(settings.voiceId);
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState("");
  const [saved, setSaved] = useState(false);

  async function detectLocal(): Promise<void> {
    const bridge = (window as unknown as DetectBridge).jarvisDesktop;
    if (!bridge?.detectHermes) {
      setDetectNote("La detección automática solo está disponible dentro de la app de escritorio.");
      return;
    }

    setDetecting(true);
    setDetectNote("Buscando Hermes local…");
    try {
      const result = await bridge.detectHermes();
      if (!result.found) {
        setDetectNote(result.error || "No se encontró Hermes.");
        return;
      }
      if (result.url) setHermesUrl(result.url);
      if (result.key) setHermesKey(result.key);
      if (result.enabled === false) {
        setDetectNote("Hermes detectado, pero el API server está desactivado.");
        return;
      }
      setDetectNote(
        `Detectado en ${result.url || `127.0.0.1:${result.port || 8643}`}${result.gateway === false ? " · gateway sin responder" : ""}.`,
      );
    } catch (detectError) {
      setDetectNote(detectError instanceof Error ? detectError.message : "No se pudo detectar Hermes.");
    } finally {
      setDetecting(false);
    }
  }

  const updateOrbState = (state: OrbVisualState, patch: { color?: string; expansion?: number }): void => {
    setSettings({
      orbStates: {
        ...settings.orbStates,
        [state]: { ...settings.orbStates[state], ...patch },
      },
    });
  };
  function save(): void {
    apply();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  const apply = (): void => {
    setSettings({
      hermesUrl: hermesUrl.trim() || settings.hermesUrl,
      hermesKey: hermesKey.trim(),
      model: model.trim() || "hermes-agent",
      elevenLabsKey: elevenLabsKey.trim(),
      voiceId: voiceId.trim() || settings.voiceId,
    });
  };

  return (
    <div className="settings-backdrop" onMouseDown={() => setSettingsOpen(false)}>
      <aside className="settings" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings-head">
          <div>
            <span className="eyebrow">CONFIGURACIÓN</span>
            <h2>Enlace JARVIS</h2>
          </div>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Cerrar">
            <CloseIcon />
          </button>
        </header>

        <div className={`settings-status settings-status-${connection}`}>
          <i />
          <span>{STATUS_LABEL[connection]}</span>
        </div>

        <label className="field">
          <span>Cerebro de JARVIS (Hermes API)</span>
          <input
            value={hermesUrl}
            onChange={(event) => setHermesUrl(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="http://127.0.0.1:8643/v1"
          />
          <small>
            El cerebro de JARVIS (Hermes) corre en local y escucha en <code>127.0.0.1:8643</code>. Ajusta la URL si usas otro puerto.
          </small>
        </label>

        <label className="field">
          <span>API key del cerebro (Hermes)</span>
          <input
            value={hermesKey}
            onChange={(event) => setHermesKey(event.target.value)}
            type="password"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="API_SERVER_KEY"
          />
          <small>Debe coincidir con <code>platforms.api_server.extra.key</code> de Hermes.</small>
        </label>

        <div className="settings-detect">
          <button type="button" className="ghost small" onClick={() => void detectLocal()} disabled={detecting}>
            {detecting ? "Detectando…" : "Detectar Hermes local"}
          </button>
          {detectNote ? <small>{detectNote}</small> : null}
        </div>

        <label className="field">
          <span>Modelo</span>
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="hermes-agent"
          />
          <small>Se valida contra <code>/v1/models</code>; si no existe se usa el primero disponible.</small>
        </label>

        <label className="field">
          <span>ElevenLabs API key</span>
          <input
            value={elevenLabsKey}
            onChange={(event) => setElevenLabsKey(event.target.value)}
            type="password"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="sk_..."
          />
          <small>El secreto que empieza por <code>sk_</code>, con permiso <code>text_to_speech</code>.</small>
        </label>

        <label className="field">
          <span>Voice ID</span>
          <input
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="bk9pYhUWGgt4Nf0ivB3g"
          />
          <small>La misma voz está configurada en el cerebro de Hermes (`tts.elevenlabs.voice_id`).</small>
        </label>

        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.autoSpeak}
            onChange={(event) => setSettings({ autoSpeak: event.target.checked })}
          />
          <span className="toggle-track"><i /></span>
          <span className="toggle-label">Hablar automáticamente cada respuesta</span>
        </label>

        <div className="settings-orb">
          <span className="eyebrow">ESTADOS DEL ORBE</span>
          {ORB_STATES.map((state) => {
            const config = settings.orbStates[state.id];
            return (
              <div className="orb-state-row" key={state.id}>
                <div className="orb-state-title">
                  <strong>{state.label}</strong>
                  <span>{config.expansion.toFixed(2)}×</span>
                </div>
                <div className="orb-state-controls">
                  <input
                    type="color"
                    value={config.color}
                    onChange={(event) => updateOrbState(state.id, { color: event.target.value })}
                    aria-label={`Color de ${state.label}`}
                  />
                  <input
                    type="range"
                    min="0.7"
                    max="1.8"
                    step="0.01"
                    value={config.expansion}
                    onChange={(event) => updateOrbState(state.id, { expansion: Number(event.target.value) })}
                    aria-label={`Expansión de ${state.label}`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {saved ? <p className="settings-saved">Configuración guardada.</p> : null}

        <div className="settings-actions">
          <button type="button" className="ghost small" onClick={save}>
            Guardar configuración
          </button>
          <button
            type="button"
            className="primary small"
            onClick={() => {
              apply();
              onConnect();
            }}
            disabled={connection === "connecting"}
          >
            <PowerIcon size={15} /> {connection === "connected" ? "Reconectar" : "Conectar"}
          </button>
          <button type="button" className="ghost small" onClick={onDisconnect} disabled={connection === "idle"}>
            Desconectar
          </button>
          <button type="button" className="ghost small" onClick={onTestVoice} disabled={connection !== "connected"}>
            <SparkIcon size={15} /> Probar voz
          </button>
        </div>

        <div className="settings-note">
          <strong>Chat</strong>
          <p>
            JARVIS usa el cerebro de Hermes (<code>/v1/chat/completions</code>) con streaming SSE y
            conserva la conversación localmente.
          </p>
        </div>

        <div className="settings-note">
          <strong>Voz</strong>
          <p>
            La voz de JARVIS va directa a ElevenLabs con la voz configurada. El cerebro de Hermes también tiene la misma API key en su
            <code> .env</code> para sus propias funciones de voz.
          </p>
          <p>El orbe se alimenta del audio real reproducido (FFT), por eso responde a cada golpe de voz.</p>
        </div>

        <div className="settings-note">
          <strong>Red</strong>
          <p>
            El cerebro de JARVIS (Hermes) se ejecuta en este equipo y se detecta en <code>127.0.0.1:8643</code>.
          </p>
        </div>
      </aside>
    </div>
  );
}
