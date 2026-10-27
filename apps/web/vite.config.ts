import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev proxy injects the bearer token server-side so the browser never holds
 * privilege-bearing credentials or forges x-aion-role. Production UIs must
 * use an authenticated BFF that verifies AION Core principals.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const actionToken =
    env.AION_ACTION_DEV_TOKEN ||
    process.env.AION_ACTION_DEV_TOKEN;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5173,
      proxy: {
        "/v1": {
          target: "http://localhost:8787",
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              if (actionToken) {
                proxyReq.setHeader("Authorization", `Bearer ${actionToken}`);
              } else {
                proxyReq.removeHeader("Authorization");
              }
              // Strip client-forged privilege headers if present.
              proxyReq.removeHeader("x-aion-role");
            });
          },
        },
        "/health": "http://localhost:8787",
      },
    },
  };
});
