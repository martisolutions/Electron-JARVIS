const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  platform: process.platform,
  isElectron: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  readHermesLog: (filePath) => ipcRenderer.invoke("hermes:read-log", filePath),
  stopAllAgents: () => ipcRenderer.invoke("hermes:stop-all"),
  detectHermes: () => ipcRenderer.invoke("hermes:detect-local"),
  getSystemMetrics: () => ipcRenderer.invoke("system:metrics"),
  getBilling: () => ipcRenderer.invoke("billing:get"),
  listArtifacts: () => ipcRenderer.invoke("artifacts:list"),
  markArtifactSeen: (id) => ipcRenderer.invoke("artifacts:seen", id),
  openArtifact: (id) => ipcRenderer.invoke("artifacts:open", id),
  revealArtifact: (id) => ipcRenderer.invoke("artifacts:reveal", id),
  listCalendarEvents: () => ipcRenderer.invoke("calendar:list"),
  createCalendarEvent: (input) => ipcRenderer.invoke("calendar:create", input),
  updateCalendarEvent: (id, input) => ipcRenderer.invoke("calendar:update", id, input),
  deleteCalendarEvent: (id) => ipcRenderer.invoke("calendar:delete", id),
  onCalendarChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("calendar:changed", listener);
    return () => ipcRenderer.removeListener("calendar:changed", listener);
  },
  onCalendarAlert: (callback) => {
    const listener = (_event, alert) => callback(alert);
    ipcRenderer.on("calendar:alert", listener);
    return () => ipcRenderer.removeListener("calendar:alert", listener);
  },
  onAppView: (callback) => {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on("app:view", listener);
    return () => ipcRenderer.removeListener("app:view", listener);
  },
  pickFiles: () => ipcRenderer.invoke("files:pick"),
  listNodeWords: () => ipcRenderer.invoke("node:list"),
  addNodeWord: (input) => ipcRenderer.invoke("node:add", input),
  onNodeWords: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("node:changed", listener);
    return () => ipcRenderer.removeListener("node:changed", listener);
  },
  listPanels: () => ipcRenderer.invoke("panels:list"),
  createPanel: (input) => ipcRenderer.invoke("panels:create", input),
  updatePanel: (id, input) => ipcRenderer.invoke("panels:update", id, input),
  deletePanel: (id) => ipcRenderer.invoke("panels:delete", id),
  setPanelOpen: (id, open) => ipcRenderer.invoke("panels:set-open", id, open),
  onPanelsChanged: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("panels:changed", listener);
    return () => ipcRenderer.removeListener("panels:changed", listener);
  },
  onPanelOpen: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("panels:open", listener);
    return () => ipcRenderer.removeListener("panels:open", listener);
  },
  onSecondInstance: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("jarvis:second-instance", listener);
    return () => ipcRenderer.removeListener("jarvis:second-instance", listener);
  },
  onReminder: (callback) => {
    const listener = (_event, reminder) => callback(reminder);
    ipcRenderer.on("reminders:fire", listener);
    return () => ipcRenderer.removeListener("reminders:fire", listener);
  },
});
