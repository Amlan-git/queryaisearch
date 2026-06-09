import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeepMockProxy } from "vitest-mock-extended";
import request from "supertest";
import type { PrismaClient } from "../prisma/generated/client";

/**
 * ESM-safe module mocking.
 *
 * `vi.mock()` is hoisted to the top of the module by Vitest, so it runs
 * before `../db` and `../client` are evaluated by the route file. The mock
 * factories use `await import(...)` because in ESM mode there's no `require`
 * — and they cannot reference any statically-imported binding at the top of
 * this file (TDZ error if you try).
 *
 * To get a handle on the mock instances, we import them *after* registering
 * the mocks. `import { prisma } from "../db"` then resolves to the mocked
 * module's `prisma` export — which IS the mock.
 *
 * `vi.hoisted` is used only for the Supabase stub because its surface is
 * tiny enough that we don't need `mockDeep`.
 */
const supabaseAuthMock = vi.hoisted(() => ({
    getUser: vi.fn()
}));

vi.mock("../db", async () => {
    const { mockDeep } = await import("vitest-mock-extended");
    return { prisma: mockDeep() };
});

vi.mock("../client", () => ({
    createSupabaseClient: () => ({ auth: supabaseAuthMock })
}));

// Imports below resolve to the mocked modules.
const { prisma } = await import("../db");
const { default: authRouter } = await import("./auth.routes");
const { createTestApp } = await import("../test/createTestApp");

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;
const app = createTestApp(authRouter);

const validBody = { name: "Ada Lovelace", provider: "GOOGLE" as const };

beforeEach(() => {
    supabaseAuthMock.getUser.mockReset();
    prismaMock.user.upsert.mockReset();
});

describe("POST /signup", () => {
    it("rejects an invalid body with 400 and field-level details", async () => {
        const res = await request(app)
            .post("/signup")
            .set("Authorization", "Bearer good-token")
            .send({ name: "", provider: "FACEBOOK" });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Invalid request");
        expect(res.body.details).toBeDefined();
        // No DB or Supabase calls should have been attempted on validation failure.
        expect(supabaseAuthMock.getUser).not.toHaveBeenCalled();
        expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });

    it("rejects a missing Authorization header with 401", async () => {
        const res = await request(app).post("/signup").send(validBody);
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: "No token provided" });
        expect(supabaseAuthMock.getUser).not.toHaveBeenCalled();
    });

    it("rejects an invalid Supabase token with 401", async () => {
        supabaseAuthMock.getUser.mockResolvedValue({
            data: { user: null },
            error: { message: "JWT expired" }
        });

        const res = await request(app)
            .post("/signup")
            .set("Authorization", "Bearer expired-token")
            .send(validBody);

        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: "Invalid or expired token" });
        expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    });

    it("upserts the user using id/email from the verified JWT, not the body", async () => {
        // The test deliberately puts a different email in the body to prove
        // it is NOT used — the verified user's email from Supabase wins.
        // This is the core security property of the handler.
        supabaseAuthMock.getUser.mockResolvedValue({
            data: { user: { id: "user-123", email: "verified@example.com" } },
            error: null
        });
        prismaMock.user.upsert.mockResolvedValue({
            id: "user-123",
            email: "verified@example.com",
            name: "Ada Lovelace",
            provider: "GOOGLE"
        } as Awaited<ReturnType<typeof prismaMock.user.upsert>>);

        const res = await request(app)
            .post("/signup")
            .set("Authorization", "Bearer good-token")
            .send({ ...validBody, email: "attacker@example.com" });

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe("user-123");

        // Critical security assertion: the upsert call must use the JWT's
        // user id, not anything from the request body.
        const upsertArgs = prismaMock.user.upsert.mock.calls[0]![0];
        expect(upsertArgs.where).toEqual({ id: "user-123" });
        expect(upsertArgs.create).toMatchObject({
            id: "user-123",
            email: "verified@example.com"
        });
    });

    it("returns 500 with the signup-specific message when the DB write fails", async () => {
        supabaseAuthMock.getUser.mockResolvedValue({
            data: { user: { id: "user-123", email: "verified@example.com" } },
            error: null
        });
        prismaMock.user.upsert.mockRejectedValue(new Error("connection reset"));

        const res = await request(app)
            .post("/signup")
            .set("Authorization", "Bearer good-token")
            .send(validBody);

        expect(res.status).toBe(500);
        // Locks the action-label routing in DB_ERROR_MESSAGE.
        expect(res.body).toEqual({ error: "Failed to create user account" });
    });
});

describe("POST /signin", () => {
    it("returns the signin-specific DB error message", async () => {
        // Exists specifically to lock the per-action DB_ERROR_MESSAGE map —
        // a refactor that collapses the messages would break this test.
        supabaseAuthMock.getUser.mockResolvedValue({
            data: { user: { id: "user-123", email: "verified@example.com" } },
            error: null
        });
        prismaMock.user.upsert.mockRejectedValue(new Error("db down"));

        const res = await request(app)
            .post("/signin")
            .set("Authorization", "Bearer good-token")
            .send(validBody);

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: "Failed to sign in user" });
    });

    it("succeeds for an existing user (upsert update path)", async () => {
        supabaseAuthMock.getUser.mockResolvedValue({
            data: { user: { id: "user-456", email: "ada@example.com" } },
            error: null
        });
        prismaMock.user.upsert.mockResolvedValue({
            id: "user-456",
            email: "ada@example.com",
            name: "Ada Lovelace",
            provider: "GOOGLE"
        } as Awaited<ReturnType<typeof prismaMock.user.upsert>>);

        const res = await request(app)
            .post("/signin")
            .set("Authorization", "Bearer good-token")
            .send(validBody);

        expect(res.status).toBe(200);
        expect(res.body.data.email).toBe("ada@example.com");
    });
});
