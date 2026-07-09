import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";

export interface UsageEvent {
	apiKeyId: string | null;
	project: string | null;
	endpoint: string;
	provider: string | null;
	bytes: number | null;
	status: number;
	latencyMs: number;
}

export interface UsageSummaryRow {
	project: string | null;
	endpoint: string;
	requests: number;
	ok: number;
	bytes: number;
	total_latency_ms: number;
}

/** Aggregate usage per project + endpoint — the basis for reporting / billing. */
export function usageSummary(): UsageSummaryRow[] {
	return db
		.prepare(
			`SELECT project, endpoint,
			        COUNT(*)                                            AS requests,
			        SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) AS ok,
			        COALESCE(SUM(bytes), 0)                             AS bytes,
			        COALESCE(SUM(latency_ms), 0)                        AS total_latency_ms
			 FROM usage_events
			 GROUP BY project, endpoint
			 ORDER BY project, endpoint`,
		)
		.all() as UsageSummaryRow[];
}

/** Best-effort usage record — never let metering failures break a request. */
export function recordUsage(event: UsageEvent): void {
	try {
		db.prepare(
			`INSERT INTO usage_events
			   (id, api_key_id, project, endpoint, provider, bytes, status, latency_ms, created_at)
			 VALUES (@id, @apiKeyId, @project, @endpoint, @provider, @bytes, @status, @latencyMs, @created_at)`,
		).run({ id: randomUUID(), created_at: new Date().toISOString(), ...event });
	} catch (err) {
		console.error("usage record failed", err);
	}
}
