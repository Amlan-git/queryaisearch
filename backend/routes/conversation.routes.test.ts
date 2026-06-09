import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeepMockProxy } from "vitest-mock-extended";
import request from "supertest";
import type { PrismaClient } from "../prisma/generated/client";

/**
 * Same ESM-safe mock pattern as auth.routes.test.ts — see that file's
 * preamble for the rationale. Conversation routes don't need a Supabase
 * mock because they don't verify tokens themselves (the global verifyToken
 * middleware would, but we mount the router directly in tests via
 * createTestApp with a pre-set `req.user`).
 */
vi.mock("../db", async () => {
    const { mockDeep } = await import("vitest-mock-extended");
    return { prisma: mockDeep() };
});

const { prisma } = await import("../db");
const { default: conversationRouter } = await import("./conversation.routes");
const { createTestApp } = await import("../test/createTestApp");

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const OWNER_ID = "owner-user-id";
const OTHER_USER_ID = "other-user-id";
const CONV_ID = "conv-uuid-abc";

const app = createTestApp(conversationRouter, { user: { id: OWNER_ID } });

beforeEach(() => {
    prismaMock.conversation.findUnique.mockReset();
    prismaMock.conversation.findMany.mockReset();
    prismaMock.conversation.findFirst.mockReset();
    prismaMock.conversation.update.mockReset();
    prismaMock.conversation.delete.mockReset();
});

/**
 * Ownership semantics for `/:conversationId` are the single most important
 * security property of this router — getting them wrong leaks one user's
 * conversation history to another. Test each branch independently.
 */
describe("GET /:conversationId — ownership semantics", () => {
    it("returns 404 when the conversation does not exist", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue(null);

        const res = await request(app).get(`/${CONV_ID}`);

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Conversation not found" });
        // No second query should be issued.
        expect(prismaMock.conversation.findFirst).not.toHaveBeenCalled();
    });

    it("returns 403 when the conversation belongs to another user", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OTHER_USER_ID
        } as Awaited<ReturnType<typeof prismaMock.conversation.findUnique>>);

        const res = await request(app).get(`/${CONV_ID}`);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Access denied" });
        // Critical: the messages query must NOT run after ownership fails.
        expect(prismaMock.conversation.findFirst).not.toHaveBeenCalled();
    });

    it("returns 200 with messages when the caller owns the conversation", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OWNER_ID
        } as Awaited<ReturnType<typeof prismaMock.conversation.findUnique>>);
        prismaMock.conversation.findFirst.mockResolvedValue({
            id: CONV_ID,
            userId: OWNER_ID,
            title: "Test",
            messages: [{ id: 1, role: "USER", content: "hi" }]
        } as unknown as Awaited<ReturnType<typeof prismaMock.conversation.findFirst>>);

        const res = await request(app).get(`/${CONV_ID}`);

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(CONV_ID);
        expect(res.body.data.messages).toHaveLength(1);

        // The detailed query must be additionally scoped by userId — belt
        // and suspenders against a future change to the ownership check.
        const findFirstArgs = prismaMock.conversation.findFirst.mock.calls[0]![0];
        expect(findFirstArgs?.where).toMatchObject({
            id: CONV_ID,
            userId: OWNER_ID
        });
    });
});

describe("PATCH /:conversationId", () => {
    it("rejects an invalid title with 400 — ownership check still runs first", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OWNER_ID
        } as Awaited<ReturnType<typeof prismaMock.conversation.findUnique>>);

        const res = await request(app).patch(`/${CONV_ID}`).send({ title: "" });

        expect(res.status).toBe(400);
        // Ownership check ran (we want a 403 to be impossible for the wrong user
        // even with bad input — i.e., bad input cannot probe existence).
        expect(prismaMock.conversation.findUnique).toHaveBeenCalled();
        expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    });

    it("blocks rename when the caller does not own the conversation", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OTHER_USER_ID
        } as Awaited<ReturnType<typeof prismaMock.conversation.findUnique>>);

        const res = await request(app)
            .patch(`/${CONV_ID}`)
            .send({ title: "New name" });

        expect(res.status).toBe(403);
        expect(prismaMock.conversation.update).not.toHaveBeenCalled();
    });
});

describe("DELETE /:conversationId", () => {
    it("blocks deletion when the caller does not own the conversation", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OTHER_USER_ID
        } as Awaited<ReturnType<typeof prismaMock.conversation.findUnique>>);

        const res = await request(app).delete(`/${CONV_ID}`);

        expect(res.status).toBe(403);
        expect(prismaMock.conversation.delete).not.toHaveBeenCalled();
    });

    it("returns 204 and deletes when the caller owns the conversation", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OWNER_ID
        } as Awaited<ReturnType<typeof prismaMock.conversation.findUnique>>);
        prismaMock.conversation.delete.mockResolvedValue({
            id: CONV_ID
        } as Awaited<ReturnType<typeof prismaMock.conversation.delete>>);

        const res = await request(app).delete(`/${CONV_ID}`);

        expect(res.status).toBe(204);
        expect(prismaMock.conversation.delete).toHaveBeenCalledWith({
            where: { id: CONV_ID }
        });
    });
});

describe("GET / — listing is always scoped to the caller", () => {
    it("queries `where: { userId: caller.id }` and never widens", async () => {
        prismaMock.conversation.findMany.mockResolvedValue([]);

        await request(app).get("/").expect(200);

        const findManyArgs = prismaMock.conversation.findMany.mock.calls[0]![0];
        expect(findManyArgs?.where).toEqual({ userId: OWNER_ID });
    });
});
