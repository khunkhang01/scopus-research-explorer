import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Map 'obsidian' to a stub so tests can import src files that use Obsidian APIs
      obsidian: path.resolve(__dirname, "tests/mocks/obsidian.ts"),
    },
  },
  test: {
    globals: true,
  },
});
