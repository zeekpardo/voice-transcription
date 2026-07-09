import { Hono } from "hono";
import type { AppEnv } from "../app-types.js";
import { badGateway } from "../lib/errors.js";
import { mintStreamToken } from "../lib/stream-token.js";

/**
 * POST /v1/stream-token  (requires Authorization: Bearer vk_live_...)
 *
 * Mints a short-lived token the browser uses to open WS /v1/stt/stream directly,
 * so the long-lived key never reaches the client. → { token, expiresIn }
 */
export const streamToken = new Hono<AppEnv>();

streamToken.post("/stream-token", (c) => {
	const key = c.get("apiKey");
	const minted = mintStreamToken(key.project);
	if (!minted) {
		throw badGateway("Streaming tokens are not configured (set ADMIN_TOKEN or STREAM_TOKEN_SECRET)");
	}
	return c.json(minted);
});
