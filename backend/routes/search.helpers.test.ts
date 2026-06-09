import { describe, it, expect } from "vitest";
import {
    formatSearchResultsForPrompt,
    formatSourcesForClient,
    parseFollowUps,
    fallbackFollowUps
} from "./search.helpers";
import type { SearchResult } from "../search/search.service";

const sampleResults: SearchResult[] = [
    {
        title: "Bun vs Node",
        url: "https://example.com/bun-vs-node",
        content: "Bun has faster cold-start than Node for small scripts.",
        rawContent: null
    },
    {
        title: "Production servers",
        url: "https://example.com/prod-servers",
        content: "Node is more battle-tested for long-running prod servers.",
        rawContent: null
    }
];

describe("formatSearchResultsForPrompt", () => {
    it("renders a numbered, citation-aligned block", () => {
        const out = formatSearchResultsForPrompt(sampleResults);
        // Lock the numbered prefix — the LLM's [1]/[2] citations must align with these.
        expect(out).toContain("[1] Bun vs Node");
        expect(out).toContain("[2] Production servers");
        expect(out).toContain("URL: https://example.com/bun-vs-node");
        expect(out).toContain("Snippet: Bun has faster cold-start");
    });

    it("substitutes safe defaults for missing fields", () => {
        const out = formatSearchResultsForPrompt([
            { title: "", url: "", content: "", rawContent: null }
        ]);
        expect(out).toContain("[1] Untitled source");
        expect(out).toContain("URL: No URL provided");
        expect(out).toContain("Snippet: No snippet available.");
    });

    it("falls back to rawContent when content is empty", () => {
        const out = formatSearchResultsForPrompt([
            { title: "Title", url: "https://x", content: "", rawContent: "Raw fallback" }
        ]);
        expect(out).toContain("Snippet: Raw fallback");
    });

    it("returns an empty string on no results", () => {
        expect(formatSearchResultsForPrompt([])).toBe("");
    });
});

describe("formatSourcesForClient", () => {
    it("shapes results into the source-card schema", () => {
        const out = formatSourcesForClient(sampleResults);
        expect(out).toEqual([
            { url: "https://example.com/bun-vs-node", title: "Bun vs Node", snippet: "Bun has faster cold-start than Node for small scripts." },
            { url: "https://example.com/prod-servers", title: "Production servers", snippet: "Node is more battle-tested for long-running prod servers." }
        ]);
    });

    it("never emits undefined fields (would break JSON.stringify expectations on the frontend)", () => {
        const out = formatSourcesForClient([
            { title: "", url: "", content: "", rawContent: null }
        ]);
        expect(out[0]).toEqual({
            url: "",
            title: "Web Search Reference",
            snippet: ""
        });
    });
});

describe("parseFollowUps", () => {
    it("parses a bare JSON array", () => {
        expect(parseFollowUps('["a", "b", "c"]')).toEqual(["a", "b", "c"]);
    });

    it("parses a JSON object with a `followUps` key", () => {
        expect(parseFollowUps('{"followUps": ["x", "y"]}')).toEqual(["x", "y"]);
    });

    it("strips ```json fences", () => {
        expect(parseFollowUps('```json\n["a", "b"]\n```')).toEqual(["a", "b"]);
    });

    it("strips bare ``` fences", () => {
        expect(parseFollowUps('```\n["a", "b"]\n```')).toEqual(["a", "b"]);
    });

    it("falls back to numbered text when JSON parsing fails", () => {
        const text = "1. First question?\n2. Second question?\n3. Third question?";
        expect(parseFollowUps(text)).toEqual([
            "First question?",
            "Second question?",
            "Third question?"
        ]);
    });

    it("falls back to bulleted text (- and *)", () => {
        const text = "- First\n* Second\n- Third";
        expect(parseFollowUps(text)).toEqual(["First", "Second", "Third"]);
    });

    it("caps the output at 5 items", () => {
        const text = JSON.stringify(["1", "2", "3", "4", "5", "6", "7"]);
        expect(parseFollowUps(text)).toEqual(["1", "2", "3", "4", "5"]);
    });

    it("drops non-string entries from a JSON array", () => {
        // The Gemini SDK has been known to emit `[{"q":"..."}]` on bad days.
        expect(parseFollowUps('["valid", 123, null, "also valid"]')).toEqual([
            "valid",
            "also valid"
        ]);
    });

    it("returns an empty array for empty input", () => {
        expect(parseFollowUps("")).toEqual([]);
    });
});

describe("fallbackFollowUps", () => {
    it("returns exactly 3 deterministic questions when no source titles are available", () => {
        const out = fallbackFollowUps("Bun vs Node", []);
        expect(out).toHaveLength(3);
        expect(out[0]).toContain("Bun vs Node");
    });

    it("uses the first source title in the third question when available", () => {
        const out = fallbackFollowUps("Bun vs Node", [
            { title: "Bun docs", url: "https://x", content: "c", rawContent: null }
        ]);
        expect(out[2]).toContain("Bun docs");
    });

    it("strips trailing punctuation from the query so generated text reads naturally", () => {
        const out = fallbackFollowUps("Is Bun fast?", []);
        expect(out[0]).toContain("Is Bun fast");
        expect(out[0]).not.toContain("?,"); // sanity: punctuation stripped before re-use
    });
});
