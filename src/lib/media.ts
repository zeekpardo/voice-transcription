import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { env } from "../env.js";
import { badGateway, badRequest } from "../lib/errors.js";

const exec = promisify(execFile);

// Audio normalization for xAI: 16 kHz mono MP3 (~0.5 MB/min). Duration is added
// per-call from the resolved time range.
const AUDIO_ARGS = ["-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-q:a", "5"];

// Generous enough for ~90 min media on a slow connection / machine.
const YT_DLP_TIMEOUT_MS = 15 * 60 * 1000;
const FFMPEG_TIMEOUT_MS = 20 * 60 * 1000;

export interface ExtractedAudio {
	audio: Buffer;
	filename: string;
	contentType: string;
}

/** Optional time window (seconds) to transcribe only part of the media. */
export interface MediaRange {
	start?: number;
	end?: number;
}

/** Extract audio from a URL (YouTube/Vimeo/etc. via yt-dlp, or a direct media URL). */
export async function extractAudioFromUrl(url: string, range: MediaRange = {}): Promise<ExtractedAudio> {
	assertHttpUrl(url);
	const { start, duration } = resolveRange(range);
	const hasWindow = range.start != null || range.end != null;

	const dir = await mkdtemp(join(tmpdir(), "vg-media-"));
	try {
		// 1) Grab the best audio stream — only the requested window when given, so a
		//    2-hour stream doesn't get fully downloaded to transcribe 30 minutes.
		const args = ["-f", "bestaudio/best", "--no-playlist", "--max-filesize", "500M", "--no-progress"];
		if (hasWindow) {
			args.push("--download-sections", `*${start}-${start + duration}`, "--force-keyframes-at-cuts");
		}
		args.push("-o", join(dir, "src.%(ext)s"), url);

		try {
			await exec("yt-dlp", args, { timeout: YT_DLP_TIMEOUT_MS, maxBuffer: 8 << 20 });
		} catch (e) {
			throw badGateway("Could not fetch audio from that link", trimErr(e));
		}

		const src = (await readdir(dir)).find((f) => f.startsWith("src."));
		if (!src) throw badGateway("No audio stream found at that link");

		// 2) Normalize to 16 kHz mono MP3 (yt-dlp already trimmed the window; -t caps length).
		const out = join(dir, "out.mp3");
		try {
			await exec("ffmpeg", ["-y", "-i", join(dir, src), "-t", String(duration), ...AUDIO_ARGS, out], {
				timeout: FFMPEG_TIMEOUT_MS,
			});
		} catch (e) {
			throw badGateway("Could not decode the audio from that link", trimErr(e));
		}

		return { audio: await readFile(out), filename: "audio.mp3", contentType: "audio/mpeg" };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Extract audio from an uploaded media file (video or audio) using ffmpeg. */
export async function extractAudioFromBuffer(
	input: Buffer,
	ext = "mp4",
	range: MediaRange = {},
): Promise<ExtractedAudio> {
	const { start, duration } = resolveRange(range);
	const dir = await mkdtemp(join(tmpdir(), "vg-media-"));
	try {
		const inPath = join(dir, `in.${sanitizeExt(ext)}`);
		const out = join(dir, "out.mp3");
		await writeFile(inPath, input);
		// -ss before -i = fast input seek; -t = output duration.
		const seek = start > 0 ? ["-ss", String(start)] : [];
		try {
			await exec("ffmpeg", ["-y", ...seek, "-i", inPath, "-t", String(duration), ...AUDIO_ARGS, out], {
				timeout: FFMPEG_TIMEOUT_MS,
			});
		} catch {
			throw badRequest("Could not extract audio from that file (unsupported or corrupt media)");
		}
		return { audio: await readFile(out), filename: "audio.mp3", contentType: "audio/mpeg" };
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Resolve a requested {start,end} window into a start offset + capped duration. */
function resolveRange(range: MediaRange): { start: number; duration: number } {
	const max = env.MEDIA_MAX_DURATION_SECONDS;
	const start = range.start != null ? Math.max(0, range.start) : 0;
	let duration = max;
	if (range.end != null) {
		duration = range.end - start;
		if (duration <= 0) throw badRequest('"end" must be greater than "start"');
		duration = Math.min(duration, max);
	}
	return { start, duration };
}

/** Parse a time value (seconds number, or "SS" / "MM:SS" / "HH:MM:SS") to seconds. */
export function parseTimeToSeconds(v: unknown): number | undefined {
	if (v == null || v === "") return undefined;
	if (typeof v === "number") return v >= 0 ? v : undefined;
	const str = String(v).trim();
	if (str.includes(":")) {
		const parts = str.split(":").map(Number);
		if (parts.some((p) => Number.isNaN(p))) throw badRequest(`Invalid time: ${str}`);
		return parts.reduce((acc, p) => acc * 60 + p, 0);
	}
	const n = Number(str);
	if (Number.isNaN(n) || n < 0) throw badRequest(`Invalid time: ${str}`);
	return n;
}

function assertHttpUrl(url: string): void {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		throw badRequest("Invalid URL");
	}
	if (u.protocol !== "http:" && u.protocol !== "https:") {
		throw badRequest("Only http(s) URLs are supported");
	}
}

function sanitizeExt(ext: string): string {
	return /^[a-z0-9]{1,5}$/i.test(ext) ? ext : "bin";
}

function trimErr(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return msg.slice(0, 400);
}
