import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../db/index.js";

/**
 * API keys the gateway issues to YOUR projects (not the xAI key).
 * We store only a SHA-256 hash of the key plus a short prefix for display.
 * The plaintext is shown exactly once, at mint time.
 */

const KEY_PREFIX = "vk_live_";

export interface ApiKeyRecord {
	id: string;
	project: string;
	prefix: string;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

export function hashKey(plaintext: string): string {
	return createHash("sha256").update(plaintext).digest("hex");
}

/** Create a new key, persist its hash, and return the one-time plaintext. */
export function mintKey(project: string): { plaintext: string; record: ApiKeyRecord } {
	const plaintext = KEY_PREFIX + randomBytes(24).toString("base64url");
	const prefix = plaintext.slice(0, 12); // e.g. "vk_live_ab12"
	const record: ApiKeyRecord = {
		id: randomUUID(),
		project,
		prefix,
		created_at: new Date().toISOString(),
		last_used_at: null,
		revoked_at: null,
	};

	db.prepare(
		`INSERT INTO api_keys (id, project, prefix, key_hash, created_at)
		 VALUES (@id, @project, @prefix, @key_hash, @created_at)`,
	).run({ ...record, key_hash: hashKey(plaintext) });

	return { plaintext, record };
}

/** Look up a live (non-revoked) key by its plaintext. Returns null if absent/revoked. */
export function findLiveKey(plaintext: string): ApiKeyRecord | null {
	const row = db
		.prepare(
			`SELECT id, project, prefix, created_at, last_used_at, revoked_at
			 FROM api_keys
			 WHERE key_hash = ? AND revoked_at IS NULL`,
		)
		.get(hashKey(plaintext)) as ApiKeyRecord | undefined;
	return row ?? null;
}

export function touchKey(id: string): void {
	db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(
		new Date().toISOString(),
		id,
	);
}

export function listKeys(): ApiKeyRecord[] {
	return db
		.prepare(
			`SELECT id, project, prefix, created_at, last_used_at, revoked_at
			 FROM api_keys ORDER BY created_at DESC`,
		)
		.all() as ApiKeyRecord[];
}
