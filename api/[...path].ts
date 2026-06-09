import type { VercelRequest, VercelResponse } from "@vercel/node";
// `.js` extension is required for Node's ESM runtime even though the actual
// file is `.ts` — TypeScript understands `.js` here as the compiled output
// name. Without this extension, Vercel's esbuild bundler doesn't inline the
// backend module and Node fails at runtime with ERR_MODULE_NOT_FOUND.
import app from "../backend/index.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  req.url = req.url?.replace(/^\/api(?=\/|$)/, "") || "/";
  return app(req, res);
}
