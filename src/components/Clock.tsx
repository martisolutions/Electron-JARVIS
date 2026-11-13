import { useEffect, useState } from "react";

function formatDate(date: Date): string {
  return date
    .toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" })
    .replace(/,/g, "")
    .toUpperCase();
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="topbar-clock" aria-label={`${formatDate(now)} ${formatTime(now)}`}>
      <span>{formatDate(now)}</span>
      <strong>{formatTime(now)}</strong>
    </div>
  );
}
