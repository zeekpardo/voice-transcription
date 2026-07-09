import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { env } from "../env.js";

// Ensure the parent directory for the SQLite file exists.
if (env.DB_PATH !== ":memory:") {
	mkdirSync(dirname(env.DB_PATH), { recursive: true });
}

export const db = new Database(env.DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

/** Create tables on boot (idempotent). Small enough to not need a migration tool yet. */
export function migrate(): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS api_keys (
			id           TEXT PRIMARY KEY,
			project      TEXT NOT NULL,
			prefix       TEXT NOT NULL,
			key_hash     TEXT NOT NULL UNIQUE,
			created_at   TEXT NOT NULL,
			last_used_at TEXT,
			revoked_at   TEXT
		);

		CREATE TABLE IF NOT EXISTS usage_events (
			id          TEXT PRIMARY KEY,
			api_key_id  TEXT,
			project     TEXT,
			endpoint    TEXT NOT NULL,
			provider    TEXT,
			bytes       INTEGER,
			status      INTEGER,
			latency_ms  INTEGER,
			created_at  TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_usage_key ON usage_events(api_key_id, created_at);
	`);
}
