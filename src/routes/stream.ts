import type { Context } from "hono";
import type { WSContext } from "hono/ws";
import type WebSocket from "ws";
import { findLiveKey, touchKey } from "../auth/keys.js";
import { recordUsage } from "../lib/usage.js";
import { verifyStreamToken } from "../lib/stream-token.js";
import { connectXaiStt } from "../providers/xai-stream.js";

/**
 * WebSocket handler factory for POST-upgrade /v1/stt/stream.
 *
 * Auth: `Authorization: Bearer vk_live_...` header (server-to-server callers can
 * set it) or `?key=` query param. Browsers must NOT connect here directly — they
 * proxy through their own app server, which holds the key.
 *
 * Relay: client PCM16 binary frames -> xAI; xAI JSON events -> client.
 */
export function streamHandler(c: Context) {
	// Auth by short-lived stream token (browsers) OR vk_live_ key (server-to-server).
	let project: string | null = null;
	let keyId: string | null = null;
	const streamTok = c.req.query("token");
	if (streamTok) {
		const v = verifyStreamToken(streamTok);
		if (v) project = v.project;
	} else {
		const bearer = extractKey(c);
		const key = bearer ? findLiveKey(bearer) : null;
		if (key) {
			project = key.project;
			keyId = key.id;
		}
	}

	const language = c.req.query("language");
	const sampleRate = numParam(c.req.query("sample_rate"));
	const encoding = c.req.query("encoding");
	const interim = c.req.query("interim_results");
	const diarize = c.req.query("diarize") === "true";

	let upstream: WebSocket | null = null;
	let upstreamReady = false;
	const preOpenQueue: (Buffer | string)[] = [];
	let bytes = 0;

	const flush = () => {
		for (const m of preOpenQueue) {
			if (typeof m === "string") upstream!.send(m);
			else upstream!.send(m, { binary: true });
		}
		preOpenQueue.length = 0;
	};

	return {
		onOpen(_evt: Event, ws: WSContext) {
			if (!project) {
				ws.send(JSON.stringify({ type: "error", message: "Invalid or missing credentials" }));
				ws.close(1008, "unauthorized");
				return;
			}
			if (keyId) touchKey(keyId);

			upstream = connectXaiStt({
				language,
				sampleRate,
				encoding,
				interimResults: interim == null ? true : interim === "true",
				diarize,
			});

			upstream.on("open", () => {
				upstreamReady = true;
				flush();
			});
			upstream.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
				// xAI transcript events are JSON text frames.
				if (!isBinary) ws.send(data.toString());
			});
			// Fires when the upgrade is rejected with a non-101 HTTP response.
			upstream.on("unexpected-response", (_req, res) => {
				let body = "";
				res.on("data", (d) => (body += d));
				res.on("end", () =>
					console.error(`[stream] xAI upgrade failed ${res.statusCode}: ${body.slice(0, 400)}`),
				);
			});
			upstream.on("close", (code: number, reason: Buffer) => {
				console.error(`[stream] xAI closed code=${code} reason=${reason?.toString() || "-"}`);
				try {
					ws.close(1000, "upstream closed");
				} catch {
					/* already closed */
				}
			});
			upstream.on("error", (err: Error) => {
				console.error("[stream] xAI error:", err.message);
				try {
					ws.send(JSON.stringify({ type: "error", message: "Upstream transcription error" }));
					ws.close(1011, "upstream error");
				} catch {
					/* already closed */
				}
			});
		},

		onMessage(evt: MessageEvent, _ws: WSContext) {
			const data = evt.data;
			if (typeof data === "string") {
				// Control message (e.g. {"type":"audio.done"}).
				if (upstream && upstreamReady) upstream.send(data);
				else preOpenQueue.push(data);
				return;
			}
			const buf = toBuffer(data);
			bytes += buf.length;
			if (upstream && upstreamReady) upstream.send(buf, { binary: true });
			else preOpenQueue.push(buf);
		},

		onClose() {
			try {
				upstream?.close();
			} catch {
				/* ignore */
			}
			if (project) {
				recordUsage({
					apiKeyId: keyId,
					project,
					endpoint: "stt.stream",
					provider: "xai",
					bytes,
					status: 200,
					latencyMs: 0,
				});
			}
		},

		onError() {
			try {
				upstream?.close();
			} catch {
				/* ignore */
			}
		},
	};
}

function extractKey(c: Context): string | undefined {
	const header = c.req.header("Authorization") ?? "";
	const m = header.match(/^Bearer\s+(.+)$/i);
	return m ? m[1]!.trim() : c.req.query("key");
}

function numParam(v: string | undefined): number | undefined {
	if (v == null) return undefined;
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
}

function toBuffer(data: unknown): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (data instanceof ArrayBuffer) return Buffer.from(data);
	if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	return Buffer.from(data as never);
}
