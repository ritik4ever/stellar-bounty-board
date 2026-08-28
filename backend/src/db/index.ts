import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazily-initialised singleton database client.
 *
 * The connection is created on first use so that modules that import the
 * schema (e.g. the migration runner) never attempt to open a connection
 * during unit-test runs where no DATABASE_URL is set.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _client: ReturnType<typeof postgres> | undefined;

function getDatabase() {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL environment variable is required to connect to the database"
    );
  }

  _client = postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  _db = drizzle(_client, { schema });
  return _db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDatabase() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export * from "./schema";
