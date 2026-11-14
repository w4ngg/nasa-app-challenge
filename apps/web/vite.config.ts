import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repositoryRoot, "");
  return {
    plugins: [react(), tailwindcss()],
    // Relative asset and data URLs, so the build works from any sub-path (e.g. GitHub Pages /<repo>/).
    base: "./",
    envDir: repositoryRoot,
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.FLAME_API_PROXY_TARGET || "http://127.0.0.1:8000",
          changeOrigin: true,
        },
      },
    },
  };
});
