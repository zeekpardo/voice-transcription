import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

/**
 * Short-lived, signed stream tokens.
 *
 * A calling app's backend (which holds the vk_live_ key) mints one of these via
 * POST /v1/stream-token, then hands it to the browser, which opens the streaming
 * WebSocket directly with `?token=...`. The long-lived key never reaches the
 * browser; the token expires in ~2 minutes.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload)).
 */

const TTL_SECONDS = 120;

function secret(): string | null {
	return env.STREAM_TOKEN_SECRET ?? env.ADMIN_TOKEN ?? null;
}

function b64url(buf: Buffer): string {
	return buf.toString("base64url");
}

export function streamTokensEnabled(): boolean {
	return secret() !== null;
}

export function mintStreamToken(project: string): { token: string; expiresIn: number } | null {
	const s = secret();
	if (!s) return null;
	const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
	const payload = b64url(Buffer.from(JSON.stringify({ p: project, e: exp })));
	const sig = b64url(createHmac("sha256", s).update(payload).digest());
	return { token: `${payload}.${sig}`, expiresIn: TTL_SECONDS };
}

export function verifyStreamToken(token: string): { project: string } | null {
	const s = secret();
	if (!s) return null;
	const dot = token.indexOf(".");
	if (dot <= 0) return null;
	const payload = token.slice(0, dot);
	const sig = token.slice(dot + 1);
	const expected = b64url(createHmac("sha256", s).update(payload).digest());
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	try {
		const { p, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		if (typeof p !== "string" || typeof e !== "number") return null;
		if (Math.floor(Date.now() / 1000) > e) return null;
		return { project: p };
	} catch {
		return null;
	}
}
