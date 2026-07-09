import { env } from "../env.js";
import { badGateway, payloadTooLarge, tooManyRequests } from "../lib/errors.js";
import { withRetry } from "../lib/http.js";
import type { TranscribeInput, TranscribeResult, VoiceProvider } from "./types.js";

/**
 * xAI implementation of the VoiceProvider interface.
 * Docs: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
 */
export const xaiProvider: VoiceProvider = {
	name: "xai",

	async transcribe({ audio, filename, language, format }: TranscribeInput): Promise<TranscribeResult> {
		const attempt = () => {
			// Build a fresh FormData per attempt (bodies are single-use).
			// xAI requires `file` to be the LAST field in the multipart form.
			const form = new FormData();
			form.append("format", format);
			form.append("language", language);
			form.append("file", audio, filename);

			return fetch(`${env.XAI_BASE_URL}/stt`, {
				method: "POST",
				headers: { Authorization: `Bearer ${env.XAI_API_KEY}` },
				body: form,
			});
		};

		let res: Response;
		try {
			res = await withRetry(attempt);
		} catch (err) {
			throw badGateway("Could not reach transcription provider", err);
		}

		if (!res.ok) {
			throw mapUpstreamError(res.status, await safeText(res));
		}

		const data = (await res.json()) as { text?: string };
		if (typeof data.text !== "string") {
			throw badGateway("Transcription provider returned an unexpected response", data);
		}

		return { text: data.text, language, provider: "xai" };
	},
};

/**
 * Translate an upstream failure into a caller-facing error.
 * Note: an upstream 401 means OUR xAI key is bad (server misconfig) — we must
 * NOT echo it as a 401 to the caller, whose key is fine.
 */
function mapUpstreamError(status: number, detail: string) {
	switch (status) {
		case 401:
		case 403:
			return badGateway("Transcription provider rejected the server credentials", detail);
		case 413:
			return payloadTooLarge("Audio file rejected by provider as too large");
		case 429:
			return tooManyRequests();
		default:
			return badGateway(`Transcription provider error (${status})`, detail);
	}
}

async function safeText(res: Response): Promise<string> {
	try {
		return (await res.text()).slice(0, 500);
	} catch {
		return "<no body>";
	}
}
