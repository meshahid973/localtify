import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "renderer-license-notices",
      generateBundle() {
        const sections = [
          readFileSync(new URL("./THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8"),
          "UI SDK (@ui-sdk/core and @ui-sdk/react)\n" + readFileSync(new URL("./node_modules/@ui-sdk/react/LICENSE", import.meta.url), "utf8"),
          "Three.js\n" + readFileSync(new URL("./node_modules/three/LICENSE", import.meta.url), "utf8"),
        ];
        this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: sections.join("\n\n") });
      },
    },
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: true,
    modulePreload: {
      polyfill: false
    },
    chunkSizeWarningLimit: 950,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/.test(id)) return "vendor-react";
          if (/[\\/]node_modules[\\/](?:motion|motion-dom|motion-utils|framer-motion)[\\/]/.test(id)) return "vendor-motion";
          if (id.includes("lucide-react")) return "vendor-icons";
          return undefined;
        }
      }
    }
  },
  optimizeDeps: {
    include: ["react", "react-dom", "lucide-react", "motion"]
  }
});

