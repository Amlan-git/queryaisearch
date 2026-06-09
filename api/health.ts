import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Dedicated liveness endpoint — imports nothing from `backend/`.
 *
 * The `/health` route inside Express (`backend/index.ts`) goes through
 * `api/[...path].ts`, which imports the entire backend module graph:
 * Prisma client + adapter + generated internals, Supabase client, the
 * AI SDK, Tavily, all middleware. Any of those failing to initialize
 * at module load (missing env var, bundling gap, Prisma generated
 * internals not packaged, etc.) takes down `/health` too — exactly the
 * scenario that makes uptime monitoring useless. We learned that the
 * hard way during the initial Vercel deployment.
 *
 * This function imports only `@vercel/node`'s request/response types
 * (erased at compile time, not a runtime dependency). It will respond
 * 200 OK regardless of whether the rest of the app boots cleanly,
 * giving uptime checks a true liveness signal independent of app
 * health.
 *
 * Filesystem routing precedence: Vercel picks specific files over
 * dynamic catch-alls, so `api/health.ts` here handles `/api/health`
 * before `api/[...path].ts` ever sees it. The `vercel.json` rewrite
 * `/health -> /api/health` therefore lands here, not in Express.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
    res.status(200).json({ ok: true });
}
