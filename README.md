# voice-gateway

A standalone voice API that fronts **xAI**. Your projects (Cadence, WAGOAT, …)
call *this* service; it owns the `xai-` key and speaks a stable, provider-
agnostic contract. Swap xAI for another vendor later by changing one file — no
caller changes.

**This slice:** on-demand **speech-to-text**. TTS and real-time streaming are
scaffolded for later (see [Roadmap](#roadmap)).

```
  Cadence / WAGOAT / any project
        │  Authorization: Bearer vk_live_...   (keys YOU issue)
        ▼
   voice-gateway   ── holds the ONE xai- key, server-side only
        │  Authorization: Bearer xai-...
        ▼
      xAI /v1/stt
```

## Stack

- **Hono** (portable HTTP — Node/Bun/Cloudflare/Fly/Railway)
- **better-sqlite3** — self-contained store for issued keys + usage
- **TypeScript**, run with **tsx**

## Setup

```bash
pnpm install
cp .env.example .env      # then edit .env
```

For the video/URL transcription features, install **ffmpeg** and **yt-dlp**
(`brew install ffmpeg yt-dlp`). Not needed for plain audio transcription.

Set your real xAI key in `.env`:

```
XAI_API_KEY="xai-...your real key..."
```

## Run

```bash
pnpm dev        # watch mode
pnpm start      # once
```

Listens on `http://localhost:8787` (set `PORT` to change).

## Issue API keys to your projects

Keys are stored **hashed** (SHA-256); the plaintext is shown once at mint time.

```bash
pnpm key:mint cadence     # mint a key for the "cadence" project
pnpm key:mint wagoat
pnpm key:list             # show issued keys (prefix + last-used)
```

## Endpoints

### `GET /health` — public

```json
{ "ok": true, "service": "voice-gateway", "ts": "..." }
```

### `POST /v1/transcribe` — requires `Authorization: Bearer vk_live_...`

`multipart/form-data`:

| field    | required | notes |
|----------|----------|-------|
| `file`   | yes      | audio **or video** — audio extracted for video |
| `language` | no     | BCP-47 code, e.g. `en` (defaults to `DEFAULT_LANGUAGE`) |
| `format` | no       | `true`/`false` — xAI natural-text formatting |
| `start` / `end` | no | time window — `"MM:SS"`, `"HH:MM:SS"`, or seconds. Transcribe only that slice. |

Response:

```json
{ "text": "…transcript…", "language": "en", "provider": "xai" }
```

Errors use a consistent envelope: `{ "error": { "code": "...", "message": "..." } }`
(`401` bad/missing key, `413` too large, `429` rate-limited, `502` upstream error).

### `WS /v1/stt/stream` — real-time streaming (WebSocket)

For low-latency transcription (partial results as you speak). Auth via
`Authorization: Bearer vk_live_...` header (server-to-server) or `?key=` query.

Query params (forwarded to xAI): `language`, `sample_rate` (default 16000),
`encoding` (`pcm`), `interim_results` (default true), `endpointing`,
`diarize` (`true` labels speakers — `transcript.partial` words gain a `speaker` number).

- **Client → server:** raw **PCM16, 16 kHz, mono** binary frames, then a text
  frame `{"type":"audio.done"}` to finish.
- **Server → client:** JSON events — `transcript.partial` (with `is_final` /
  `speech_final`), `transcript.done`, `error`.

Test from the CLI:

```bash
ffmpeg -i clip.wav -f s16le -ar 16000 -ac 1 /tmp/speech.pcm
pnpm stream:try /tmp/speech.pcm      # streams it through the gateway, prints live events
```

```bash
curl -X POST http://localhost:8787/v1/transcribe \
  -H "Authorization: Bearer vk_live_..." \
  -F "language=en" \
  -F "file=@note.webm;type=audio/webm"
```

**Video files work too** — a `video/*` upload has its audio extracted with ffmpeg
before transcription (larger cap: `MEDIA_MAX_UPLOAD_BYTES`, default 1 GB).

### `POST /v1/transcribe/url` — transcribe a link (video/YouTube)

`application/json`: `{ "url": "...", "language": "en", "start"?, "end"? }`. Fetches
the media (YouTube/Vimeo/direct link via yt-dlp), extracts audio, and transcribes.

`start`/`end` (`"MM:SS"`, `"HH:MM:SS"`, or seconds) transcribe **only that window**
— e.g. just the sermon inside a full-service stream. For URLs, yt-dlp downloads
*only* that slice, so a 2-hour stream isn't fully fetched to transcribe 30 minutes.

```bash
# just the sermon: 35:00–70:00 of a full service
curl -X POST http://localhost:8787/v1/transcribe/url \
  -H "Authorization: Bearer vk_live_..." -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=...","start":"35:00","end":"70:00"}'
```

> Requires **ffmpeg** and **yt-dlp** on the host/deploy. Extraction is clamped to
> `MEDIA_MAX_DURATION_SECONDS` (default **1 h 30 min**). Only transcribe content you
> have the rights to; server-side URL fetching should sit behind trusted callers.

## Calling from Cadence / WAGOAT

Use **[`@noba/voice-kit`](kit/README.md)** — the reusable client. You get live mic
transcription + file upload for the browser (vanilla or a React hook), plus the
backend proxy helpers, so you don't rewrite any of this per app.

```ts
// backend upload route (holds the key, proxies to this gateway)
import { transcribeAudio } from "@noba/voice-kit/server";
const { text } = await transcribeAudio(file, {
  gatewayUrl: process.env.VOICE_GATEWAY_URL!,   // http://localhost:8787
  apiKey:     process.env.VOICE_GATEWAY_KEY!,   // vk_live_...
});
```

```tsx
// UI (headless hook, style it yourself)
import { useVoiceTranscription } from "@noba/voice-kit/react";
const v = useVoiceTranscription({ streamUrl: "/api/voice/stream", uploadUrl: "/api/voice/transcribe" });
```

See [`kit/README.md`](kit/README.md) for the full wire-up. The gateway key stays
server-side — the browser only ever talks to your app's own routes.

## Try it in a browser

```bash
pnpm demo     # runs a demo app (a stand-in "calling project") on :8788
```

**http://localhost:8788/** — an xAI-styled live transcription page: **Live
transcription** streams words as you speak (Web Audio → PCM16 → WS → gateway →
xAI), and **Upload audio** runs a file through the batch endpoint. Both flows in
one UI.

The demo's WS proxy ([`examples/browser-demo/server.ts`](examples/browser-demo/server.ts))
is the reference for wiring streaming into Cadence/WAGOAT — the browser never
holds the key.

## Configuration (`.env`)

| var | default | purpose |
|-----|---------|---------|
| `XAI_API_KEY` | — (required) | xAI key, server-side only |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | upstream base |
| `PORT` | `8787` | listen port |
| `DB_PATH` | `./data/gateway.db` | SQLite file (keys + usage) |
| `DEFAULT_LANGUAGE` | `en` | fallback transcription language |
| `STT_FORMAT` | `true` | xAI formatted-text toggle |
| `MAX_UPLOAD_BYTES` | `157286400` | audio upload cap (150 MB, ~90 min) |
| `MEDIA_MAX_UPLOAD_BYTES` | `1073741824` | video-file upload cap (1 GB) |
| `MEDIA_MAX_DURATION_SECONDS` | `5400` | max extract/transcribe length (1 h 30 min) |

## Project layout

```
src/
  index.ts            server bootstrap
  app.ts              Hono app: middleware, routes, error envelope
  env.ts              env parsing/validation (zod)
  app-types.ts        shared Hono context types
  auth/
    keys.ts           mint / hash / lookup issued keys
    middleware.ts     Bearer API-key auth
  db/index.ts         SQLite connection + migrate
  lib/
    errors.ts         AppError + error helpers
    http.ts           retry/backoff for upstream calls
    usage.ts          per-request usage metering
  providers/
    types.ts          VoiceProvider interface  ← the swap point
    xai.ts            xAI implementation (STT; TTS reserved)
    index.ts          provider selection
  routes/
    health.ts
    transcribe.ts
    stream.ts           WS proxy → xAI streaming STT
scripts/
  mint-key.ts         pnpm key:mint <project>
  list-keys.ts        pnpm key:list
  try-stream.ts       pnpm stream:try <file.pcm>
kit/                  @noba/voice-kit — reusable client (browser + react + server)
examples/
  browser-demo/       live UI, built on the kit
```

## Roadmap

- ✅ **Batch STT** — `POST /v1/transcribe`.
- ✅ **Streaming STT** — `WS /v1/stt/stream` (real-time, done).
- **TTS** — `POST /v1/speak` (xAI `/v1/tts`). `VoiceProvider.synthesize` and the
  types are already stubbed.
- **Translate** — `POST /v1/translate` (Grok) — the missing middle for sermons.
- **Voice agents** — STT → Grok → TTS composition.
- **Live sermon translation** — streaming STT → translate → streaming TTS with
  per-listener fan-out. The single-stream real-time plumbing exists now; the
  multi-listener delivery layer is the separate, harder piece (consider Pipecat /
  LiveKit Agents there, with this gateway as the control plane).

## Known gaps

- Streaming connections can hit **transient xAI errors** (e.g. rate limits under
  rapid reconnects). Surfaced to the client as an `error` event today; add
  reconnect/backoff before production.
- No per-key **rate limiting** yet.

## Notes / TODO before production

- Per-key **rate limiting** (table + middleware) — not yet enforced.
- **Upload moderation** (NSFW/abuse) before forwarding — see spec §12 if reused.
- Swap tsx-at-runtime for a compiled build in the deploy image if you prefer.
- SQLite is fine to start; move keys/usage to Postgres/Turso if you need
  multi-instance horizontal scale.
