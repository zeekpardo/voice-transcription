/**
 * Browser demo — a stand-in CALLING PROJECT (like Cadence/WAGOAT) built on
 * @noba/voice-kit. It shows how little app-specific code is needed:
 *   - server: kit/server helpers (transcribeAudio + openGatewayStream)
 *   - browser: kit/browser module (createLiveTranscriber + transcribeFile)
 *
 * The gateway key lives here (server-side), never in the browser.
 * Run:  pnpm demo   (gateway must be running too)
 */
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type WebSocket from "ws";
import { openGatewayStream, transcribeAudio, transcribeUrl } from "../../kit/src/server.js";

const PORT = Number(process.env.DEMO_PORT ?? 8788);
const GATEWAY = process.env.VOICE_GATEWAY_URL ?? "http://localhost:8787";

const KEY = process.env.VOICE_KEY ?? tryRead(new URL("../../.test-key", import.meta.url));
if (!KEY) {
	console.error("❌ No gateway key. Set VOICE_KEY=vk_live_... or create .test-key");
	process.exit(1);
}

// Read per request so edits show on refresh (no server restart).
const readRel = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Live transcription UI is the default. /stream kept as a redirect for old links.
app.get("/", (c) => c.html(readRel("./stream.html")));
app.get("/stream", (c) => c.redirect("/", 301));

// Serve the kit's browser module to the page.
app.get("/kit/browser.js", (c) => {
	c.header("content-type", "application/javascript; charset=utf-8");
	return c.body(readRel("../../kit/src/browser.js"));
});

// --- Batch upload proxy → gateway (kit) ---
app.post("/api/transcribe", async (c) => {
	const body = await c.req.parseBody();
	const file = body["file"];
	if (!(file instanceof File)) {
		return c.json({ error: 'Missing "file" upload', code: "bad_request" }, 400);
	}
	const start = typeof body["start"] === "string" ? body["start"] : undefined;
	const end = typeof body["end"] === "string" ? body["end"] : undefined;
	try {
		const result = await transcribeAudio(file, {
			gatewayUrl: GATEWAY,
			apiKey: KEY,
			filename: file.name || "recording",
			language: "en",
			start,
			end,
		});
		return c.json(result);
	} catch (err) {
		return c.json({ error: (err as Error).message, code: "error" }, 502);
	}
});

// --- URL (video/YouTube) proxy → gateway (kit) ---
app.post("/api/transcribe-url", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as {
		url?: string;
		language?: string;
		start?: string | number;
		end?: string | number;
	};
	if (!body.url) return c.json({ error: 'Missing "url"', code: "bad_request" }, 400);
	try {
		const result = await transcribeUrl(body.url, {
			gatewayUrl: GATEWAY,
			apiKey: KEY,
			language: body.language ?? "en",
			start: body.start,
			end: body.end,
		});
		return c.json(result);
	} catch (err) {
		return c.json({ error: (err as Error).message, code: "error" }, 502);
	}
});

// --- Streaming proxy: browser <-> here <-> gateway (kit opens the upstream) ---
app.get(
	"/ws/stream",
	upgradeWebSocket((c) => {
		const language = c.req.query("language") ?? "en";
		const diarize = c.req.query("diarize") === "true";
		let upstream: WebSocket | null = null;
		let ready = false;
		const queue: (Buffer | string)[] = [];
		const flush = () => {
			for (const m of queue) {
				if (typeof m === "string") upstream!.send(m);
				else upstream!.send(m, { binary: true });
			}
			queue.length = 0;
		};

		return {
			onOpen(_evt, ws) {
				upstream = openGatewayStream({ gatewayUrl: GATEWAY, apiKey: KEY, language, diarize });
				upstream.on("open", () => {
					ready = true;
					flush();
				});
				upstream.on("message", (data: WebSocket.RawData, isBinary: boolean) => {
					if (!isBinary) ws.send(data.toString());
				});
				upstream.on("close", () => {
					try { ws.close(); } catch { /* ignore */ }
				});
				upstream.on("error", () => {
					try {
						ws.send(JSON.stringify({ type: "error", message: "gateway connection failed" }));
						ws.close();
					} catch { /* ignore */ }
				});
			},
			onMessage(evt) {
				const d = evt.data;
				if (typeof d === "string") {
					if (upstream && ready) upstream.send(d);
					else queue.push(d);
					return;
				}
				const buf = toBuffer(d);
				if (upstream && ready) upstream.send(buf, { binary: true });
				else queue.push(buf);
			},
			onClose() {
				try { upstream?.close(); } catch { /* ignore */ }
			},
		};
	}),
);

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`🌐 browser demo:  http://localhost:${info.port}`);
	console.log(`   live transcription + upload: http://localhost:${info.port}/`);
	console.log(`   proxying to gateway: ${GATEWAY}`);
});
injectWebSocket(server);

function tryRead(url: URL): string | undefined {
	try {
		return readFileSync(url, "utf8").trim();
	} catch {
		return undefined;
	}
}

function toBuffer(data: unknown): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (data instanceof ArrayBuffer) return Buffer.from(data);
	if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	return Buffer.from(data as never);
}
