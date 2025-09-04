import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    include: ["src/__tests__/**/*.test.js"],
    coverage: {
      provider: "c8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html"],
      exclude: [
        "bundler/**",
        "package.json",
        "vitest.config.js",
        "node_modules/**",
        "dist/**",
      ],
    },
  },
});
