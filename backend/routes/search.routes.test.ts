import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DeepMockProxy } from "vitest-mock-extended";
import request from "supertest";
import type { PrismaClient } from "../prisma/generated/client";

/**
 * Mocks for search routes. We mock:
 *   - `../db`             — Prisma, via `mockDeep`.
 *   - `../middleware`     — replace the searchLimiter with a no-op so the
 *                            test doesn't have to manage a rate-limit window.
 *   - `../search/search.service` — Tavily wrapper. Always returns a fixed
 *                            results+images payload.
 *   - `ai` package        — `streamText` returns a fake async iterator that
 *                            yields a few chunks then ends. This is what
 *                            isolates the test from a live LLM call.
 *   - `@ai-sdk/google`    — `createGoogleGenerativeAI` returns a thunk so the
 *                            route's `google(modelName)` call doesn't reach
 *                            for a real API key.
 *
 * Vitest hoists all `vi.mock` calls above the imports, so the route file
 * picks up the mocked modules at import time.
 */

vi.mock("../db", async () => {
    const { mockDeep } = await import("vitest-mock-extended");
    return { prisma: mockDeep() };
});

vi.mock("../middleware", () => ({
    // Identity middleware — the searchLimiter is purely a rate-limit concern
    // and not what these tests are exercising.
    searchLimiter: (_req: unknown, _res: unknown, next: () => void) => next()
}));

vi.mock("../search/search.service", () => ({
    performSearch: vi.fn().mockResolvedValue({
        results: [
            {
                title: "Source A",
                url: "https://a.example.com",
                content: "Snippet A",
                rawContent: null
            }
        ],
        images: ["https://img.example.com/1.jpg"]
    })
}));

// `streamText` returns a thenable-ish object with a `textStream` async
// iterable. The route awaits the iterator to compose its written chunks.
// Each call returns a fresh iterator so tests can pre-program different
// answers for the answer call vs. the follow-up call.
const streamTextMock = vi.hoisted(() => vi.fn());
vi.mock("ai", () => ({
    streamText: streamTextMock
}));

vi.mock("@ai-sdk/google", () => ({
    createGoogleGenerativeAI: () => () => "fake-model-handle"
}));

const { prisma } = await import("../db");
const { default: searchRouter } = await import("./search.routes");
const { createTestApp } = await import("../test/createTestApp");

const prismaMock = prisma as unknown as DeepMockProxy<PrismaClient>;

const OWNER_ID = "owner-user-id";
const OTHER_USER_ID = "other-user-id";
const CONV_ID = "550e8400-e29b-41d4-a716-446655440000";

const app = createTestApp(searchRouter, { user: { id: OWNER_ID } });

/**
 * Builds a `streamText`-shaped fake. Each yielded string becomes one chunk
 * the route writes to its response body.
 */
function fakeStream(chunks: string[]) {
    return {
        textStream: (async function* () {
            for (const chunk of chunks) yield chunk;
        })()
    };
}

beforeEach(() => {
    prismaMock.conversation.findUnique.mockReset();
    prismaMock.conversation.create.mockReset();
    prismaMock.message.create.mockReset();
    prismaMock.message.findMany.mockReset();
    streamTextMock.mockReset();

    // Default the message writes to a no-op success so they don't block on
    // every test. Tests that care about message persistence assert against
    // the mock explicitly.
    prismaMock.message.create.mockResolvedValue({
        id: 1,
        role: "USER",
        content: "x",
        conversationId: CONV_ID,
        sources: null,
        createdAt: new Date()
    } as Awaited<ReturnType<typeof prismaMock.message.create>>);
});

describe("POST /query_ask — stream-tag contract", () => {
    it("emits META → SOURCES → IMAGES → answer chunks → FOLLOW_UPS in order", async () => {
        // New conversation flow: no conversationId in body, so a fresh one
        // is created server-side.
        prismaMock.conversation.create.mockResolvedValue({
            id: CONV_ID,
            userId: OWNER_ID,
            title: "test query",
            slug: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // First streamText call is the answer; second is follow-ups.
        streamTextMock
            .mockReturnValueOnce(fakeStream(["Hello ", "world."]))
            .mockReturnValueOnce(fakeStream(['["q1","q2","q3"]']));

        const res = await request(app)
            .post("/query_ask")
            .send({ query: "test query" });

        expect(res.status).toBe(200);

        const body = res.text;

        // Order locks the wire format the frontend's stream parser depends on.
        const metaIdx = body.indexOf("<META>");
        const sourcesIdx = body.indexOf("<SOURCES>");
        const imagesIdx = body.indexOf("<IMAGES>");
        const followIdx = body.indexOf("<FOLLOW_UPS>");

        expect(metaIdx).toBeGreaterThanOrEqual(0);
        expect(sourcesIdx).toBeGreaterThan(metaIdx);
        expect(imagesIdx).toBeGreaterThan(sourcesIdx);
        expect(followIdx).toBeGreaterThan(imagesIdx);

        // Answer text sits between IMAGES and FOLLOW_UPS.
        const answerSegment = body.slice(
            body.indexOf("</IMAGES>") + "</IMAGES>".length,
            followIdx
        );
        expect(answerSegment).toContain("Hello world.");

        // META payload contains the conversationId so the frontend can
        // register state before the answer finishes streaming.
        const metaMatch = body.match(/<META>(.*?)<\/META>/s);
        expect(metaMatch).not.toBeNull();
        const meta = JSON.parse(metaMatch![1]!);
        expect(meta.conversationId).toBe(CONV_ID);
    });

    it("rejects an oversized query at the Zod boundary before any DB write", async () => {
        const longQuery = "x".repeat(501);
        const res = await request(app)
            .post("/query_ask")
            .send({ query: longQuery });

        expect(res.status).toBe(400);
        expect(prismaMock.conversation.create).not.toHaveBeenCalled();
        expect(streamTextMock).not.toHaveBeenCalled();
    });

    it("rejects a follow-up to a conversation the caller does not own with 403", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OTHER_USER_ID,
            title: null,
            slug: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        const res = await request(app)
            .post("/query_ask")
            .send({ query: "test", conversationId: CONV_ID });

        expect(res.status).toBe(403);
        expect(streamTextMock).not.toHaveBeenCalled();
    });
});

describe("POST /query_ask/follow_up — history selection", () => {
    /**
     * Regression test for the bug fixed in `search.routes.ts`. The original
     * code did `orderBy: asc, take: 10`, which returned the *oldest* 10
     * messages. The fix is `orderBy: desc, take: 10` then `.reverse()` so the
     * LLM sees the most recent 10 turns in chronological order.
     *
     * This test asserts both halves explicitly:
     *   1. The Prisma query orders DESC and takes 10.
     *   2. The messages passed to the LLM are in chronological order.
     */
    it("loads the most recent 10 messages and passes them to the LLM in chronological order", async () => {
        prismaMock.conversation.findUnique.mockResolvedValue({
            id: CONV_ID,
            userId: OWNER_ID,
            title: null,
            slug: null,
            createdAt: new Date(),
            updatedAt: new Date()
        });

        // Simulate Prisma returning the 10 most recent messages, already DESC.
        // The handler must reverse them to chronological order before sending
        // to streamText.
        const recentDesc = [
            { role: "ASSISTANT" as const, content: "msg-15" },
            { role: "USER"      as const, content: "msg-14" },
            { role: "ASSISTANT" as const, content: "msg-13" },
            { role: "USER"      as const, content: "msg-12" },
            { role: "ASSISTANT" as const, content: "msg-11" },
            { role: "USER"      as const, content: "msg-10" },
            { role: "ASSISTANT" as const, content: "msg-9" },
            { role: "USER"      as const, content: "msg-8" },
            { role: "ASSISTANT" as const, content: "msg-7" },
            { role: "USER"      as const, content: "msg-6" }
        ];
        prismaMock.message.findMany.mockResolvedValue(
            recentDesc as unknown as Awaited<ReturnType<typeof prismaMock.message.findMany>>
        );

        streamTextMock
            .mockReturnValueOnce(fakeStream(["answer"]))
            .mockReturnValueOnce(fakeStream(['["q1","q2","q3"]']));

        const res = await request(app)
            .post("/query_ask/follow_up")
            .send({ conversationId: CONV_ID, query: "follow-up question" });

        expect(res.status).toBe(200);

        // Half 1: Prisma was queried DESC + take 10. Anything else and we're
        // back to selecting the wrong 10 messages.
        const findManyArgs = prismaMock.message.findMany.mock.calls[0]![0];
        expect(findManyArgs).toMatchObject({
            where: { conversationId: CONV_ID },
            orderBy: { createdAt: "desc" },
            take: 10
        });

        // Half 2: The first streamText call is the answer stream. Its
        // `messages` array must be chronological — oldest first, newest last,
        // with the new user message appended at the end.
        const answerCallArgs = streamTextMock.mock.calls[0]![0] as {
            messages: { role: string; content: string }[];
        };
        const contents = answerCallArgs.messages.map((m) => m.content);

        // First 10 entries should be the reversed history (chronological).
        expect(contents.slice(0, 10)).toEqual([
            "msg-6", "msg-7", "msg-8", "msg-9", "msg-10",
            "msg-11", "msg-12", "msg-13", "msg-14", "msg-15"
        ]);

        // The 11th entry is the new user question (with prompt template
        // wrapping); we just verify it's present at the end.
        expect(answerCallArgs.messages[10]!.role).toBe("user");
        expect(answerCallArgs.messages[10]!.content).toContain("follow-up question");
    });
});
