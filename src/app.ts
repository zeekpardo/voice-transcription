import { randomUUID } from "node:crypto";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { AppEnv } from "./app-types.js";
import { apiKeyAuth } from "./auth/middleware.js";
import { AppError } from "./lib/errors.js";
import { admin } from "./routes/admin.js";
import { health } from "./routes/health.js";
import { streamHandler } from "./routes/stream.js";
import { streamToken } from "./routes/stream-token.js";
import { transcribe } from "./routes/transcribe.js";
import { transcribeUrl } from "./routes/transcribe-url.js";

export const app = new Hono<AppEnv>();

// WebSocket support (bound to this app); injectWebSocket is called on the server.
export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Request id (echoed back for correlation) + access logs.
app.use("*", async (c, next) => {
	const id = c.req.header("x-request-id") ?? randomUUID();
	c.set("requestId", id);
	c.header("x-request-id", id);
	await next();
});
app.use("*", logger());

// Public.
app.route("/", health);

// Admin (key issuance + usage) — gated by ADMIN_TOKEN inside the router.
app.route("/admin", admin);

// Streaming STT (WebSocket) — does its own key auth inside the handler, so it is
// registered before the JSON auth sub-app below.
app.get("/v1/stt/stream", upgradeWebSocket(streamHandler));

// Everything under /v1 requires an issued API key.
const v1 = new Hono<AppEnv>();
v1.use("*", apiKeyAuth);
v1.route("/", transcribe);
v1.route("/", transcribeUrl);
v1.route("/", streamToken);
app.route("/v1", v1);

// Consistent error envelope.
app.onError((err, c) => {
	if (err instanceof AppError) {
		if (err.internal !== undefined) {
			console.error(`[${c.get("requestId")}] ${err.code}:`, err.internal);
		}
		return c.json({ error: { code: err.code, message: err.message } }, err.status as never);
	}
	console.error(`[${c.get("requestId")}] unhandled:`, err);
	return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
});

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));
