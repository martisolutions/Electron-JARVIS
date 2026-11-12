import { useState } from "react";
import { useStore } from "../store";
import type { ConnectionState } from "../types";
import { CloseIcon, PowerIcon, SparkIcon } from "./Icons";

type Props = {
  connection: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
  onTestVoice: () => void;
};

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: "Sin conexión",
  connecting: "Conectando",
  connected: "JARVIS en línea",
  error: "Error de conexión",
};

export function SettingsPanel({ connection, onConnect, onDisconnect, onTestVoice }: Props) {
  const settings = useStore((state) => state.settings);
  const setSettings = useStore((state) => state.setSettings);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);

  const [hermesUrl, setHermesUrl] = useState(settings.hermesUrl);
  const [hermesKey, setHermesKey] = useState(settings.hermesKey);
  const [model, setModel] = useState(settings.model);
  const [elevenLabsKey, setElevenLabsKey] = useState(settings.elevenLabsKey);
  const [voiceId, setVoiceId] = useState(settings.voiceId);

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
            placeholder="http://127.0.0.1:8642/v1"
          />
          <small>
            El cerebro de JARVIS (Hermes) escucha en 127.0.0.1:8642. En Windows se accede con el túnel SSH:
            <code> ssh -N -L 8642:127.0.0.1:8642 jarvis</code>
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

        <div className="settings-actions">
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
            El cerebro de JARVIS (Hermes) está en <code>192.168.1.3</code>. Para no exponer su API, el túnel SSH publica
            <code> 127.0.0.1:8642</code> en este equipo. Mantén el túnel activo mientras uses la app.
          </p>
        </div>
      </aside>
    </div>
  );
}
