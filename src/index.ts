import { serve } from "@hono/node-server";
import { app, injectWebSocket } from "./app.js";
import { migrate } from "./db/index.js";
import { env } from "./env.js";

migrate();

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	console.log(`🎙️  voice-gateway listening on http://localhost:${info.port}`);
	console.log(`    health:     GET  /health`);
	console.log(`    transcribe: POST /v1/transcribe        (Bearer vk_live_...)`);
	console.log(`    stream:     WS   /v1/stt/stream        (Bearer vk_live_...)`);
});

injectWebSocket(server);
