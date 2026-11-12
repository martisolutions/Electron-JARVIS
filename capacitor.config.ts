import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.jarvis.orb",
  appName: "JARVIS",
  webDir: "dist",
  backgroundColor: "#000000",
  server: {
    androidScheme: "https",
  },
};

export default config;
