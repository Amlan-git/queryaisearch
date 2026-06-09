/**
 * Global Vitest setup — runs before any test file is imported.
 *
 * Purpose: pre-populate the env vars that route/service modules read at
 * import time (Supabase client, Prisma adapter, Gemini SDK, Tavily SDK).
 * Without these, the very act of importing a route file would throw before
 * any test could run.
 *
 * The values themselves are inert — every external client is mocked in the
 * tests that actually need it, so a "real" looking URL/key here never
 * touches the network.
 */
process.env.SUPABASE_URL = "https://test.supabase.co";
process.env.SUPABASE_SECRET_KEY = "test-supabase-secret";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.TAVILY_API_KEY = "test-tavily-key";
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-gemini-key";
process.env.GOOGLE_GENERATIVE_AI_MODEL = "gemini-2.5-flash";
process.env.FRONTEND_URL = "http://localhost:3000";

// Suppress the `if (!process.env.VERCEL)` branch in index.ts in the
// (unlikely) case a test imports it — keeps app.listen() from binding.
process.env.VERCEL = "1";
