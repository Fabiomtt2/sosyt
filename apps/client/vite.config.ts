import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Conexão Youtube",
        short_name: "Conexão",
        description: "Curadoria colaborativa de playlists",
        theme_color: "#111827",
        background_color: "#f7f3ed",
        display: "standalone",
        icons: []
      }
    })
  ]
});

