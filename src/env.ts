import "dotenv/config";
import { z } from "zod";

const schema = z.object({
	XAI_API_KEY: z.string().min(1, "XAI_API_KEY is required"),
	XAI_BASE_URL: z.string().url().default("https://api.x.ai/v1"),
	PORT: z.coerce.number().int().positive().default(8787),
	DB_PATH: z.string().default("./data/gateway.db"),
	DEFAULT_LANGUAGE: z.string().default("en"),
	STT_FORMAT: z.string().default("true"),
	MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(157_286_400), // 150 MB (fits ~90 min audio)
	// Media (video files + URLs): larger uploads and a duration cap for extraction.
	MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(1_073_741_824), // 1 GB (video files)
	MEDIA_MAX_DURATION_SECONDS: z.coerce.number().int().positive().default(5400), // 1 h 30 min
	// Translation (Anthropic). Optional — /v1/translate errors clearly if the key is unset.
	ANTHROPIC_API_KEY: z.string().optional(),
	ANTHROPIC_BASE_URL: z.string().url().default("https://api.anthropic.com"),
	TRANSLATE_MODEL: z.string().default("claude-opus-4-8"),
	TRANSLATE_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
	// Admin API (key issuance + usage). If unset, /admin routes are disabled.
	ADMIN_TOKEN: z.string().optional(),
	// Signing secret for short-lived stream tokens. Falls back to ADMIN_TOKEN.
	STREAM_TOKEN_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
	console.error("❌ Invalid environment configuration:");
	for (const issue of parsed.error.issues) {
		console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
	}
	console.error("\nCopy .env.example to .env and fill in the values.");
	process.exit(1);
}

export const env = parsed.data;
