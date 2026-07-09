/**
 * Translation provider abstraction — the swap point for the translation vendor.
 * Today: Anthropic (Claude). Parallel to the voice VoiceProvider interface.
 */

export interface TranslateInput {
	text: string;
	/** BCP-47 target language codes — translated in ONE call (source billed once). */
	targets: string[];
	/** Optional source language hint. */
	sourceLang?: string;
	/** Prior text for coherence (not translated). */
	context?: string;
	/** Term list / style guide — a large glossary here is prompt-cached. */
	glossary?: string;
}

export interface TranslateResult {
	/** Map of target language code → translated text. */
	translations: Record<string, string>;
	provider: string;
	model: string;
	/** True when the cached prefix (glossary/system) was read this request. */
	cached: boolean;
}

export interface TranslationProvider {
	readonly name: string;
	translate(input: TranslateInput): Promise<TranslateResult>;
}
