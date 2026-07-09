/**
 * Retry a request with exponential backoff + jitter.
 *
 * `attempt` must build and send a *fresh* request each call — request bodies
 * (FormData / streams) are consumed on send and cannot be replayed, so the
 * caller is responsible for reconstructing them inside the thunk.
 */
export async function withRetry(
	attempt: () => Promise<Response>,
	opts: { retries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
	const retries = opts.retries ?? 2;
	const baseDelayMs = opts.baseDelayMs ?? 400;

	let lastError: unknown;
	for (let i = 0; i <= retries; i++) {
		try {
			const res = await attempt();
			if (!isRetryableStatus(res.status) || i === retries) return res;
		} catch (err) {
			lastError = err;
			if (i === retries) throw err;
		}
		const delay = baseDelayMs * 2 ** i + Math.floor(Math.random() * 100);
		await sleep(delay);
	}
	// Unreachable in practice; satisfies the type checker.
	throw lastError ?? new Error("withRetry exhausted");
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
