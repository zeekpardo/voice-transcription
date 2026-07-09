import { xaiProvider } from "./xai.js";
import type { VoiceProvider } from "./types.js";

/**
 * Central provider selection. Today there is one; when a second lands, switch
 * on an env var here and everything downstream stays the same.
 */
export const provider: VoiceProvider = xaiProvider;

export type { VoiceProvider } from "./types.js";
