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
        // AUDITORIA / "O DEPLOY NAO APARECE" — era este service worker.
        //
        // O plugin gerava um SW Workbox que faz precache do app shell, enquanto
        // main.tsx desregistra todo service worker ao iniciar. Os dois se contradizem
        // e viram uma corrida: quando o SW vencia, o navegador passava a servir o
        // shell daquele instante e o codigo novo NUNCA carregava — logo, nunca chegava
        // a rodar o desregistro. A pessoa ficava presa num laco, vendo a versao antiga
        // depois de cada publicacao e concluindo, com razao, que o deploy falhou.
        //
        // `selfDestroying` resolve na raiz: o SW publicado agora se desregistra e
        // limpa os caches dele. Quem esta preso e curado sozinho na proxima visita,
        // porque o SW antigo (autoUpdate) busca o novo sw.js e executa a propria
        // destruicao. Ninguem precisa limpar dados do site na mao.
        //
        // O manifest fica: ele serve para instalar o app e para o Capacitor/Android,
        // e nao depende de cache offline.
        selfDestroying: true,
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
