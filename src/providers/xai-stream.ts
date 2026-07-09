import WebSocket from "ws";
import { env } from "../env.js";

/**
 * Streaming STT — opens an upstream WebSocket to xAI.
 * Docs: wss://api.x.ai/v1/stt (config via query params, PCM16 binary frames).
 *
 * This is the streaming swap point (parallel to providers/xai.ts for batch).
 */
export interface XaiStreamParams {
	language?: string;
	sampleRate?: number;
	encoding?: string; // pcm | mulaw | alaw
	interimResults?: boolean;
	endpointing?: number;
	/** Speaker diarization — words[] gain a `speaker` number. */
	diarize?: boolean;
	fillerWords?: boolean;
}

export function connectXaiStt(p: XaiStreamParams): WebSocket {
	// https://api.x.ai/v1  ->  wss://api.x.ai/v1/stt
	const url = new URL(env.XAI_BASE_URL.replace(/^http/, "ws") + "/stt");
	url.searchParams.set("sample_rate", String(p.sampleRate ?? 16000));
	url.searchParams.set("encoding", p.encoding ?? "pcm");
	url.searchParams.set("interim_results", String(p.interimResults ?? true));
	if (p.endpointing != null) url.searchParams.set("endpointing", String(p.endpointing));
	if (p.language) url.searchParams.set("language", p.language);
	if (p.diarize) url.searchParams.set("diarize", "true");
	if (p.fillerWords) url.searchParams.set("filler_words", "true");

	return new WebSocket(url.toString(), {
		headers: { Authorization: `Bearer ${env.XAI_API_KEY}` },
	});
}
