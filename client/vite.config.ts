import react from "@vitejs/plugin-react";
import { createRequire } from "module";
import path from "path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const require = createRequire(import.meta.url);
const { META_CONTENT_SECURITY_POLICY } = require("../csp.js") as {
  META_CONTENT_SECURITY_POLICY: string;
};

/** CSP meta only in production HTML so Vite dev HMR (needs eval) still works on :5173. */
function cspMetaPlugin(): Plugin {
  return {
    name: "csp-meta",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.server) {
          return html;
        }
        const meta = `<meta http-equiv="Content-Security-Policy" content="${META_CONTENT_SECURITY_POLICY}" />\n    `;
        return html.replace("<head>", `<head>\n    ${meta}`);
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), cspMetaPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
