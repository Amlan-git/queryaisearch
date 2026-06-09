import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        clearMocks: true,
        restoreMocks: true,
        setupFiles: ["./test/setup.ts"],
        // Co-located tests next to source — `*.test.ts` alongside the file under test.
        include: ["**/*.test.ts"],
        exclude: ["node_modules", "prisma/generated"],
        coverage: {
            provider: "v8",
            // Reportable but not enforced. Adding thresholds is a separate decision once
            // we know which paths are intentionally light on coverage (route boilerplate)
            // vs. critically undertested.
            reporter: ["text", "html"],
            exclude: ["prisma/generated", "test", "**/*.test.ts", "vitest.config.ts"]
        }
    }
});
