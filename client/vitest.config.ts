import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.test.tsx", "node_modules"],
    server: {
      deps: {
        // Ensure solid-js store uses the same browser build as user code
        inline: [/solid-js/],
      },
    },
  },
  resolve: {
    conditions: ["browser"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
