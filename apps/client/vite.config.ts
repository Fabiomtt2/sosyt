import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(() => {
  const base = process.env.VITE_PUBLIC_BASE?.trim() || "/";
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: {
          name: "SOS YouTube",
          short_name: "SOS YouTube",
          description: "Curadoria colaborativa de playlists",
          theme_color: "#111827",
          background_color: "#f7f3ed",
          display: "standalone",
          start_url: base,
          scope: base,
          icons: []
        }
      })
    ]
  };
});
