# Query AI

Query AI is a conversational AI search engine that searches the live web, reads sources, and streams cited answers in real time. Users can try example prompts from the public homepage, sign in with Google or GitHub through Supabase Auth, and continue into an authenticated research workspace with conversation history.

## Features

- Public landing page with interactive example questions
- OAuth sign-in with Supabase Auth
- Live web search powered by Tavily
- Streaming AI answers powered by Google Gemini
- Source citations and image results
- Follow-up questions
- Conversation history stored in Postgres with Prisma
- Vercel-ready static frontend plus serverless API deployment

## Tech Stack

- Frontend: React 19, React Router, Tailwind CSS, shadcn-style UI components
- Backend: Express, Vercel Functions
- Auth: Supabase Auth
- Database: Postgres, Prisma
- Search: Tavily
- AI: Vercel AI SDK with Google Gemini
- Runtime/build: Node.js backend, Vite React frontend

## Project Structure

```txt
.
├── api/                  # Vercel serverless entrypoints
├── backend/              # Express routes, Prisma, search and AI logic
├── frontend/             # React app
├── package.json          # Root Vercel build dependencies/scripts
└── vercel.json           # Vercel routing/build configuration
```

## Environment Variables

Create environment variables locally and in Vercel:

```txt
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=

SUPABASE_URL=
SUPABASE_SECRET_KEY=

DATABASE_URL=
TAVILY_API_KEY=

GOOGLE_GENERATIVE_AI_API_KEY=
GOOGLE_GENERATIVE_AI_MODEL=gemini-2.5-flash

FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

For Vercel, set:

```txt
NODE_ENV=production
FRONTEND_URL=https://your-vercel-domain.vercel.app
```

## Local Development

Install dependencies:

```bash
cd frontend
pnpm install

cd ../backend
pnpm install
```

Run the backend:

```bash
cd backend
pnpm run dev
```

Run the frontend:

```bash
cd frontend
pnpm run dev
```

Vite serves the React app with HMR on `http://127.0.0.1:3000` and proxies API paths to the backend on `:3001`.

## Build

From the repo root:

```bash
pnpm install
pnpm run build:frontend
```

The production frontend output is written to:

```txt
frontend/dist
```

## Deployment on Vercel

This repo is configured for Vercel from the root directory.

Use these settings:

```txt
Framework Preset: Other
Root Directory: ./
Install Command: pnpm install
Build Command: pnpm run build:frontend
Output Directory: frontend/dist
```

The deployment uses:

- `frontend/dist` for static assets
- `api/[...path].ts` to route API requests into the Express backend
- `api/env.json.ts` to expose safe public Supabase config to the browser
- `vercel.json` rewrites for SPA routes and API paths

After deploying, update Supabase Auth:

```txt
Site URL:
https://your-vercel-domain.vercel.app

Redirect URLs:
https://your-vercel-domain.vercel.app/auth/callback
http://localhost:3000/auth/callback
http://127.0.0.1:3000/auth/callback
```

## API Routes

The frontend calls these paths:

```txt
POST /signin
POST /signup
POST /query_ask
GET  /conversations
GET  /conversations/:conversationId
PATCH /conversations/:conversationId
DELETE /conversations/:conversationId
GET  /health
```

On Vercel, these are rewritten to serverless functions under `/api`.

## Notes

- Use the Supabase publishable/anon key for `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Use the Supabase service role key only for `SUPABASE_SECRET_KEY`.
- Keep `DATABASE_URL` server-side only.
- If OAuth redirects to localhost in production, update Supabase Auth URL Configuration and redeploy.
- If `/auth/callback` shows a blank page, make sure the latest build uses the root `frontend/index.html` entry and Vite asset paths.


