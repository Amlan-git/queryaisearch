import express from "express";
import type { Router, Request, Response, NextFunction } from "express";
import type { User } from "@supabase/supabase-js";

/**
 * Builds an Express app for testing a single router in isolation, without
 * mounting the global middleware stack from `index.ts`. This intentionally
 * skips helmet, CORS, rate-limiters, and the live Supabase JWT check.
 *
 * Tests that need to exercise auth behavior do so by mocking the Supabase
 * client at the module level — the global `verifyToken` middleware is not
 * what we're testing here.
 *
 * If `user` is provided, a tiny middleware attaches it to `req.user` so
 * downstream handlers see an authenticated context, matching what the real
 * `verifyToken` would set after a successful token check.
 */
export function createTestApp(
    router: Router,
    options: { mountPath?: string; user?: Partial<User> } = {}
) {
    const { mountPath = "/", user } = options;
    const app = express();

    // Match the production payload limit so tests catch the same 413/parse failures.
    app.use(express.json({ limit: "10kb" }));

    if (user) {
        app.use((req: Request, _res: Response, next: NextFunction) => {
            req.user = user as User;
            next();
        });
    }

    app.use(mountPath, router);
    return app;
}
