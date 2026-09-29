import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, "test/vscode.mock.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
