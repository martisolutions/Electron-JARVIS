import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const desktop = (window as unknown as { jarvisDesktop?: { platform: string; isElectron: boolean } }).jarvisDesktop;
if (desktop) {
  const platformClass =
    desktop.platform === "win32" ? "win" : desktop.platform === "darwin" ? "mac" : desktop.platform;
  document.documentElement.classList.add("desktop", platformClass);
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
