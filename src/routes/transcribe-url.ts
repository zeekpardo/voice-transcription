import { Hono } from "hono";
import type { AppEnv } from "../app-types.js";
import { env } from "../env.js";
import { badRequest } from "../lib/errors.js";
import { extractAudioFromUrl, parseTimeToSeconds } from "../lib/media.js";
import { recordUsage } from "../lib/usage.js";
import { provider } from "../providers/index.js";

export const transcribeUrl = new Hono<AppEnv>();

/**
 * POST /v1/transcribe/url   (application/json)
 *   { url: string, language?: string, start?, end? }
 *   start/end: optional time window ("MM:SS", "HH:MM:SS", or seconds) — transcribe
 *   only that slice (e.g. just the sermon inside a full-service stream).
 *
 * Fetches a video/audio link (YouTube, Vimeo, direct media, …), extracts the
 * audio, and transcribes it. → { text, language, provider }
 */
transcribeUrl.post("/transcribe/url", async (c) => {
	const key = c.get("apiKey");
	const startedAt = Date.now();

	const body = (await c.req.json().catch(() => ({}))) as {
		url?: unknown;
		language?: unknown;
		start?: unknown;
		end?: unknown;
	};
	if (typeof body.url !== "string" || !body.url) {
		throw badRequest('Missing "url" in JSON body');
	}
	const language = typeof body.language === "string" ? body.language : env.DEFAULT_LANGUAGE;
	const start = parseTimeToSeconds(body.start);
	const end = parseTimeToSeconds(body.end);

	let status = 200;
	let bytes = 0;
	try {
		const { audio, filename, contentType } = await extractAudioFromUrl(body.url, { start, end });
		bytes = audio.length;
		const result = await provider.transcribe({
			audio: new Blob([audio], { type: contentType }),
			filename,
			language,
			format: env.STT_FORMAT,
		});
		return c.json(result);
	} catch (err) {
		status = (err as { status?: number }).status ?? 500;
		throw err;
	} finally {
		recordUsage({
			apiKeyId: key.id,
			project: key.project,
			endpoint: "transcribe.url",
			provider: provider.name,
			bytes,
			status,
			latencyMs: Date.now() - startedAt,
		});
	}
});
