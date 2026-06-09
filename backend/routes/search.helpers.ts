import type { SearchResult } from "../search/search.service.js";

/**
 * Pure helpers extracted from `search.routes.ts` so they can be unit-tested
 * without spinning up an Express request, a database, or any external HTTP
 * client. The route file imports from this module — there is no other
 * intended consumer.
 *
 * Keep these functions side-effect-free: no `console.log`, no clock reads,
 * no network. That contract is what makes the tests cheap and stable.
 */

/**
 * Renders the numbered list of source snippets that gets injected into the
 * answer-generation prompt. The format is part of the LLM contract — the
 * model is instructed to cite via `[1]`, `[2]`, etc. matching these indices.
 * Changes here can silently break citation alignment.
 */
export function formatSearchResultsForPrompt(results: SearchResult[]): string {
    return results
        .map((result, index) => {
            const title = result.title || "Untitled source";
            const url = result.url || "No URL provided";
            const content = result.content || result.rawContent || "No snippet available.";

            return [
                `[${index + 1}] ${title}`,
                `URL: ${url}`,
                `Snippet: ${content}`
            ].join("\n");
        })
        .join("\n\n");
}

/**
 * Shapes Tavily's raw results into the source-card schema the frontend
 * consumes via the `<SOURCES>` stream block. Defensive defaults so a
 * missing field never propagates as `undefined` to JSON.stringify.
 */
export function formatSourcesForClient(results: SearchResult[]) {
    return results.map((result) => ({
        url: result.url || "",
        title: result.title || "Web Search Reference",
        snippet: result.content || result.rawContent || ""
    }));
}

/**
 * Parses the LLM's follow-up suggestions into a clean string[]. The model
 * is asked to return a JSON array, but real-world output drifts: it may
 * wrap the array in ```json fences, return an object `{ followUps: [...] }`,
 * or fall back to plain numbered / bulleted text on retries. Each branch
 * is intentional and covered by the tests.
 *
 * Always returns at most 5 items so a hallucinated long list can't blow
 * up the UI layout.
 */
export function parseFollowUps(text: string): string[] {
    const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();

    try {
        const parsed = JSON.parse(cleaned);
        const items = Array.isArray(parsed) ? parsed : parsed.followUps;

        if (Array.isArray(items)) {
            return items
                .filter((item): item is string => typeof item === "string")
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 5);
        }
    } catch {
        // Fall through to the text-format parser below.
    }

    return cleaned
        .split("\n")
        .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
        .filter(Boolean)
        .slice(0, 5);
}

/**
 * Deterministic fallback used when the follow-up LLM call fails or returns
 * nothing parseable. Always returns 3 strings so the frontend's "follow-up
 * chips" row never renders empty.
 */
export function fallbackFollowUps(query: string, sources: SearchResult[]): string[] {
    const firstSourceTitle = sources.find((source) => source.title)?.title;
    const baseQuery = query.replace(/[?.!]+$/g, "").trim();

    return [
        `What are the key details about ${baseQuery}?`,
        `How does ${baseQuery} compare with other options?`,
        firstSourceTitle
            ? `What details from ${firstSourceTitle} matter most?`
            : `What changed recently about ${baseQuery}?`
    ].filter(Boolean).slice(0, 3);
}
