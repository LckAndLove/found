import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appConfig } from "../../config.js";

export type SqliteDatabase = {
  path: string;
  connection: DatabaseSync;
  close(): void;
};

export function createSqliteDatabase(path = defaultDatabasePath()): SqliteDatabase {
  mkdirSync(dirname(path), { recursive: true });

  const connection = new DatabaseSync(path);
  connection.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = ${appConfig.storage.sqlite.busyTimeoutMs};
  `);
  migrate(connection);

  return {
    path,
    connection,
    close() {
      connection.close();
    }
  };
}

function defaultDatabasePath() {
  return process.env.FOUND_DB_PATH ?? join(process.cwd(), appConfig.storage.sqlite.relativePath);
}

function migrate(connection: DatabaseSync) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = connection.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as
    | { version: number | null }
    | undefined;
  const currentVersion = row?.version ?? 0;

  if (currentVersion < 1) {
    connection.exec(`
      CREATE TABLE IF NOT EXISTS fund_watchlist (
        code TEXT PRIMARY KEY CHECK (length(code) = 6),
        name TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_fund_watchlist_sort_order
        ON fund_watchlist (sort_order, created_at);

      INSERT INTO schema_migrations (version) VALUES (1);
    `);
  }
}
