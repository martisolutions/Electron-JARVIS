import { useEffect, useState, type CSSProperties } from "react";
import type { NodeWord, OrbVisualState } from "../types";

type Props = {
  words: NodeWord[];
  zoom: number;
  capacity: number;
  mode: OrbVisualState;
  color?: string;
};

export function NodeWords({ words, zoom, capacity, mode, color }: Props) {
  const clampedZoom = Math.max(0.82, Math.min(1.55, zoom));
  const sharp = clampedZoom > 1.06;
  const visible = words.slice(0, Math.max(1, capacity));
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const speed = mode === "delegated" ? 0.07 : mode === "talking" ? 0.045 : mode === "thinking" ? 0.028 : 0.016;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const delta = Math.min(0.05, (now - last) / 1000);
      last = now;
      setPhase((value) => (value + delta * speed) % (Math.PI * 2));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  return (
    <div
      className={`node-words mode-${mode}`}
      style={{ transform: `translate(-50%, -50%) scale(${clampedZoom})`, "--node-tag": color, "--node-tag-strong": color } as CSSProperties}
      aria-hidden="true"
    >
      {visible.map((entry, index) => {
        const slot = Math.floor((index * capacity) / Math.max(1, visible.length));
        const angle = phase + (slot / Math.max(1, capacity)) * Math.PI * 2 - Math.PI / 2 + 0.72;
        const radius = 33;
        const x = 50 + Math.cos(angle) * radius;
        const y = 50 + Math.sin(angle) * radius * 0.92;
        return (
          <span
            key={entry.id}
            className={`node-word ${index === 0 ? "is-latest" : ""} ${sharp ? "is-sharp" : "is-soft"}`}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              animationDelay: `${(index % 12) * -0.37}s`,
              opacity: index === 0 ? 1 : Math.max(0.28, 0.7 - index * 0.018),
            }}
            title={entry.context ? `${entry.word} · ${entry.context}` : entry.word}
          >
            {entry.word}
          </span>
        );
      })}
    </div>
  );
}
