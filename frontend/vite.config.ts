import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const proxyRoutes = [
  "/signin",
  "/signup",
  "/query_ask",
  "/conversations",
  "/health",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "query-env-json",
        configureServer(server) {
          server.middlewares.use("/env.json", (_req, res) => {
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-store");
            res.end(
              JSON.stringify({
                VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
                VITE_SUPABASE_PUBLISHABLE_KEY: env.VITE_SUPABASE_PUBLISHABLE_KEY,
              })
            );
          });
        },
      },
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      proxy: Object.fromEntries(
        proxyRoutes.map((route) => [
          route,
          {
            target: "http://127.0.0.1:3001",
            changeOrigin: true,
          },
        ])
      ),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
