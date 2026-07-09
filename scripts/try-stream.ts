/**
 * CLI real-time tester: streams a raw PCM16 (16 kHz mono) file through the
 * gateway WebSocket and prints transcript events live.
 *
 *   pnpm stream:try <pcmFile> [wsUrl]
 *   # default file: /tmp/speech.pcm, default url: ws://localhost:8787/v1/stt/stream
 *
 * Make a PCM file from any audio:
 *   ffmpeg -i clip.wav -f s16le -ar 16000 -ac 1 /tmp/speech.pcm
 */
import { readFileSync } from "node:fs";
import WebSocket from "ws";

const ROOT = new URL("..", import.meta.url);
const pcmPath = process.argv[2] ?? "/tmp/speech.pcm";
const wsUrl =
	process.argv[3] ?? "ws://localhost:8787/v1/stt/stream?language=en&interim_results=true";
const key = process.env.VOICE_KEY ?? readFileSync(new URL(".test-key", ROOT), "utf8").trim();

const pcm = readFileSync(pcmPath);
const CHUNK = 3200; // 100 ms of 16 kHz PCM16
console.log(`streaming ${pcm.length} bytes from ${pcmPath} → ${wsUrl}\n`);

const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${key}` } });

ws.on("open", async () => {
	for (let i = 0; i < pcm.length; i += CHUNK) {
		ws.send(pcm.subarray(i, i + CHUNK), { binary: true });
		await sleep(100); // pace like real-time capture
	}
	ws.send(JSON.stringify({ type: "audio.done" }));
});

ws.on("message", (raw: WebSocket.RawData) => {
	let ev: {
		type?: string;
		text?: string;
		is_final?: boolean;
		speech_final?: boolean;
		words?: Array<{ text: string; speaker?: number }>;
	};
	try {
		ev = JSON.parse(raw.toString());
	} catch {
		return;
	}
	if (ev.type === "transcript.partial") {
		const tag = ev.speech_final ? "FINAL " : ev.is_final ? "chunk " : "interim";
		const speakers = [...new Set((ev.words ?? []).map((w) => w.speaker).filter((s) => s != null))];
		const who = speakers.length ? ` (speaker ${speakers.join(",")})` : "";
		console.log(`  [${tag}]${who} ${ev.text ?? ""}`);
	} else if (ev.type === "transcript.done") {
		console.log(`\n✅ done: "${ev.text ?? ""}"`);
		ws.close();
	} else if (ev.type === "transcript.created") {
		console.log("  (upstream ready)");
	} else if (ev.type === "error") {
		console.error("  ⚠️ error:", ev);
	}
});

ws.on("close", (code) => {
	console.log(`\nsocket closed (${code})`);
	process.exit(0);
});
ws.on("error", (e) => {
	console.error("socket error:", e.message);
	process.exit(1);
});

function sleep(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}
