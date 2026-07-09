/**
 * Provider abstraction — the single swap point for the underlying voice vendor.
 * Today: xAI. Swapping to Deepgram/ElevenLabs/etc. means implementing this
 * interface; no route or caller changes.
 */

export interface TranscribeInput {
	/** Raw audio bytes as a Blob (from the multipart upload). */
	audio: Blob;
	filename: string;
	/** BCP-47 language code, e.g. "en". */
	language: string;
	/** Provider "formatted text" toggle. */
	format: string;
}

export interface TranscribeResult {
	text: string;
	language: string;
	provider: string;
}

// --- Text-to-speech (interface reserved; not implemented in this slice) ---
export interface SynthesizeInput {
	text: string;
	voice: string;
	language: string;
	format?: { codec: string; sampleRate: number; bitRate?: number };
}

export interface SynthesizeResult {
	audio: Uint8Array;
	contentType: string;
	provider: string;
}

export interface VoiceProvider {
	readonly name: string;
	transcribe(input: TranscribeInput): Promise<TranscribeResult>;
	/** Reserved for the TTS slice. */
	synthesize?(input: SynthesizeInput): Promise<SynthesizeResult>;
}
