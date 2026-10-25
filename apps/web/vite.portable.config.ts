import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { copyFileSync } from "node:fs";
export default defineConfig({ base: "./", plugins: [react(), { name: "portable-index", closeBundle() { copyFileSync(resolve(__dirname, "dist-portable/portable.html"), resolve(__dirname, "dist-portable/index.html")); } }], build: { outDir: "dist-portable", emptyOutDir: true, chunkSizeWarningLimit: 1100, rollupOptions: { input: resolve(__dirname, "portable.html") } } });
