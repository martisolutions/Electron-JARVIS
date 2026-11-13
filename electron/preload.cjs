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
  pickFiles: () => ipcRenderer.invoke("files:pick"),
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
