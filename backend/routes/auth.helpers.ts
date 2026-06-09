import type { Request } from "express";

/**
 * Pulls the Supabase JWT out of the `Authorization: Bearer <token>` header.
 *
 * Returns null on any structural failure — missing header, wrong scheme,
 * or an empty/whitespace-only token slot. The contract is "non-empty
 * string or null," which lets callers rely on `if (!token)` as the single
 * rejection point without separately guarding against `""`.
 *
 * Extracted from the route file so it can be unit-tested without spinning
 * up an Express request.
 */
export function extractBearerToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.split(" ")[1]?.trim();
    return token ? token : null;
}
