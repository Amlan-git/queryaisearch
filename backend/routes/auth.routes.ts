import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { createSupabaseClient } from "../client.js";
import { extractBearerToken } from "./auth.helpers.js";
import z from "zod";

/**
 * Validation schema for OAuth-backed sign-in / sign-up payloads.
 * Enforced at the API edge so downstream code never sees untrusted shapes.
 */
const SignupSchema = z.object({
    name: z.string().min(1, "Name cannot be empty").max(100).trim(),
    provider: z.enum(["GOOGLE", "GITHUB"])
});

/**
 * `/signup` and `/signin` were originally two duplicate handlers. The flows are
 * structurally identical for OAuth-only auth:
 *   1. Validate body  →  2. Verify Supabase JWT  →  3. Upsert user row.
 *
 * They are exposed as two routes because the frontend (and any future analytics
 * consumers) distinguishes the two intents in logs. The handler is shared, and
 * the `action` label flows into log prefixes and the user-facing 500 message so
 * each route preserves its prior observable behavior.
 */

type AuthAction = "signup" | "signin";

const DB_ERROR_MESSAGE: Record<AuthAction, string> = {
    signup: "Failed to create user account",
    signin: "Failed to sign in user"
};

async function syncOAuthUser(req: Request, res: Response, action: AuthAction): Promise<void> {
    // 1. Boundary validation. We log the field errors at warn level so noisy
    //    misconfigured clients are observable without escalating to error pages.
    const parseResult = SignupSchema.safeParse(req.body);
    if (!parseResult.success) {
        console.warn(`[${action}] Failure: Invalid body payload`, parseResult.error.flatten().fieldErrors);
        res.status(400).json({
            error: "Invalid request",
            details: parseResult.error.flatten().fieldErrors
        });
        return;
    }

    // 2. Bearer token extraction. The Supabase JWT travels in the Authorization
    //    header for both routes — the body itself is unauthenticated.
    const token = extractBearerToken(req);
    if (!token) {
        console.warn(`[${action}] Failure: No token provided`);
        res.status(401).json({ error: "No token provided" });
        return;
    }

    // 3. Verify the JWT against Supabase's auth service.
    //    A fresh client per request avoids any chance of session state leaking
    //    across concurrent requests on a shared module-level instance.
    const supabase = createSupabaseClient();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
        console.warn(`[${action}] Failure: Invalid or expired token`, error?.message);
        res.status(401).json({ error: "Invalid or expired token" });
        return;
    }

    // 4. Upsert the user row.
    //    - id / email come from the verified JWT, never the request body, so a
    //      malicious client cannot claim another user's identity.
    //    - upsert (not create) makes the endpoint idempotent: repeat sign-ups,
    //      sign-ins after a local DB reset, and OAuth re-links all converge to
    //      the same row without unique-constraint violations.
    try {
        const user = await prisma.user.upsert({
            where: { id: data.user.id },
            update: { name: parseResult.data.name },
            create: {
                id: data.user.id,
                email: data.user.email!,
                name: parseResult.data.name,
                provider: parseResult.data.provider
            }
        });

        console.log(`[${action}] Success: User synced (ID: ${user.id})`);
        res.status(200).json({ data: user });
    } catch (dbError: unknown) {
        // Log the real exception server-side; return a generic message so the
        // client can't probe schema/table details via crafted payloads.
        console.error(`[${action}] DB Error syncing user:`, dbError);
        res.status(500).json({ error: DB_ERROR_MESSAGE[action] });
    }
}

const router = Router();

router.post("/signup", (req, res) => syncOAuthUser(req, res, "signup"));
router.post("/signin", (req, res) => syncOAuthUser(req, res, "signin"));

export default router;
