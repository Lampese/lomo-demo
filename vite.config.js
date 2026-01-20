import { defineConfig } from "vite";

export default defineConfig({
  base: "/lomo-demo/",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2020",
  },
});
