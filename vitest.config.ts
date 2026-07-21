import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The CLI tests spawn a real subprocess through tsx, which is slow to boot.
    testTimeout: 20_000,
  },
});
