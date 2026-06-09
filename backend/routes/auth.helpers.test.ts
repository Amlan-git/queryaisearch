import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { extractBearerToken } from "./auth.helpers";

/**
 * Minimal Request stub. `extractBearerToken` only reads `headers.authorization`,
 * so we don't need a real Express request — duck-typing is enough.
 */
function reqWith(authorization?: string): Request {
    return { headers: { authorization } } as unknown as Request;
}

describe("extractBearerToken", () => {
    it("returns the token from a well-formed Bearer header", () => {
        expect(extractBearerToken(reqWith("Bearer abc123"))).toBe("abc123");
    });

    it("returns null when the header is missing entirely", () => {
        expect(extractBearerToken(reqWith(undefined))).toBeNull();
    });

    it("returns null for a non-Bearer scheme", () => {
        expect(extractBearerToken(reqWith("Basic abc123"))).toBeNull();
    });

    it("is case-sensitive on the scheme (RFC 6750 says case-insensitive, but the impl is strict — locked here so a change is intentional)", () => {
        expect(extractBearerToken(reqWith("bearer abc123"))).toBeNull();
    });

    it("returns null when only the scheme is present", () => {
        // `"Bearer".startsWith("Bearer ")` is false → null.
        expect(extractBearerToken(reqWith("Bearer"))).toBeNull();
    });

    it("returns null when the token slot is empty or whitespace", () => {
        // Contract is "non-empty string or null" — callers rely on `if (!token)`
        // as the single rejection point.
        expect(extractBearerToken(reqWith("Bearer "))).toBeNull();
        expect(extractBearerToken(reqWith("Bearer    "))).toBeNull();
    });
});
