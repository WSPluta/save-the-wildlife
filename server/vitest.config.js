import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    coverage: {
      provider: "c8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html"],
      exclude: [
        "index.js",
        "server.js",
        "package.json",
        "vitest.config.js",
        "node_modules/**",
      ],
    },
  },
});
