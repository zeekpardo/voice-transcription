import { Hono } from "hono";
import type { AppEnv } from "../app-types.js";
import { env } from "../env.js";
import { badRequest, payloadTooLarge } from "../lib/errors.js";
import { extractAudioFromBuffer, parseTimeToSeconds } from "../lib/media.js";
import { recordUsage } from "../lib/usage.js";
import { provider } from "../providers/index.js";

export const transcribe = new Hono<AppEnv>();

/**
 * POST /v1/transcribe   (multipart/form-data)
 *   file      — audio OR video (required): wav, mp3, webm, ogg, m4a, mp4, mov, mkv…
 *               Video files have their audio extracted (ffmpeg) before transcription.
 *   language  — BCP-47 code (optional, defaults to DEFAULT_LANGUAGE)
 *   format    — "true"/"false" (optional, defaults to STT_FORMAT)
 * →  { text, language, provider }
 */
transcribe.post("/transcribe", async (c) => {
	const key = c.get("apiKey");
	const startedAt = Date.now();

	const body = await c.req.parseBody();
	const file = body["file"];

	if (!(file instanceof File)) {
		throw badRequest('Missing "file" field (multipart/form-data audio/video upload)');
	}
	if (file.size === 0) {
		throw badRequest("Uploaded file is empty");
	}

	// Normalize e.g. "audio/webm;codecs=opus" (from MediaRecorder) to "audio/webm".
	const mime = file.type.split(";")[0]!.trim().toLowerCase();
	const isVideo = mime.startsWith("video/");
	if (mime && !mime.startsWith("audio/") && !isVideo) {
		throw badRequest(`Unsupported content-type: ${file.type} (expected audio or video)`);
	}

	const cap = isVideo ? env.MEDIA_MAX_UPLOAD_BYTES : env.MAX_UPLOAD_BYTES;
	if (file.size > cap) {
		throw payloadTooLarge(`File is ${file.size} bytes; limit is ${cap} bytes`);
	}

	const language = typeof body["language"] === "string" ? body["language"] : env.DEFAULT_LANGUAGE;
	const format = typeof body["format"] === "string" ? body["format"] : env.STT_FORMAT;
	const start = parseTimeToSeconds(body["start"]);
	const end = parseTimeToSeconds(body["end"]);
	const hasRange = start != null || end != null;

	let status = 200;
	try {
		// Extract audio (via ffmpeg) for video, OR when a time window is requested;
		// otherwise send the audio file as-is.
		let audio: Blob = file;
		let filename = file.name || "audio";
		if (isVideo || hasRange) {
			const buf = Buffer.from(await file.arrayBuffer());
			const ext = (file.name.split(".").pop() || (isVideo ? "mp4" : "audio")).toLowerCase();
			const extracted = await extractAudioFromBuffer(buf, ext, { start, end });
			audio = new Blob([extracted.audio], { type: extracted.contentType });
			filename = extracted.filename;
		}

		const result = await provider.transcribe({ audio, filename, language, format });
		return c.json(result);
	} catch (err) {
		status = (err as { status?: number }).status ?? 500;
		throw err;
	} finally {
		recordUsage({
			apiKeyId: key.id,
			project: key.project,
			endpoint: isVideo ? "transcribe.video" : "transcribe",
			provider: provider.name,
			bytes: file.size,
			status,
			latencyMs: Date.now() - startedAt,
		});
	}
});
