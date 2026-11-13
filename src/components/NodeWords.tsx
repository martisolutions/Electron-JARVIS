import type { NodeWord } from "../types";

type Props = {
  words: NodeWord[];
  zoom: number;
};

export function NodeWords({ words, zoom }: Props) {
  const clampedZoom = Math.max(0.82, Math.min(1.55, zoom));
  return (
    <div className="node-words" style={{ transform: `translate(-50%, -50%) scale(${clampedZoom})` }} aria-hidden="true">
      {words.map((entry, index) => {
        const angle = index * 2.399963 + 0.7;
        const spread = words.length > 1 ? index / (words.length - 1) : 0;
        const radius = 18 + Math.sqrt(spread) * 22;
        const x = 50 + Math.cos(angle) * radius * 1.08;
        const y = 50 + Math.sin(angle) * radius * 0.92;
        return (
          <span
            key={entry.id}
            className={`node-word ${index === 0 ? "is-latest" : ""}`}
            style={{
              left: `${x}%`,
              top: `${y}%`,
              animationDelay: `${(index % 12) * -0.37}s`,
              opacity: index === 0 ? 1 : Math.max(0.3, 0.72 - index * 0.004),
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
