import { defineConfig } from "vite";

// The site is served from https://loootai.github.io/catalog-galaxy/.
export default defineConfig({
  base: "/catalog-galaxy/",
  build: { target: "es2022", chunkSizeWarningLimit: 700 },
});
