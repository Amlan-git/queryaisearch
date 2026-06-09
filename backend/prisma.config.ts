import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma 7 reads URL configuration from this file, not from schema.prisma.
 *
 * Migrations need a session-level Postgres connection (transactions across
 * multiple queries, prepared statements, advisory locks). PgBouncer in
 * transaction mode doesn't support those, so we point migrations at the
 * session pooler via DIRECT_URL.
 *
 * Runtime queries use a different URL — DATABASE_URL, the transaction-mode
 * pooler — and that connection is established in db.ts through the
 * @prisma/adapter-pg adapter. The two URLs are intentionally distinct.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
