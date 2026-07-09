import { migrate } from "../src/db/index.js";
import { listKeys } from "../src/auth/keys.js";

migrate();
const keys = listKeys();

if (keys.length === 0) {
	console.log("No API keys yet. Mint one with:  pnpm key:mint <project>");
	process.exit(0);
}

console.log(`\n${keys.length} key(s):\n`);
for (const k of keys) {
	const state = k.revoked_at ? "REVOKED" : "active";
	console.log(
		`  ${k.prefix}…  ${k.project.padEnd(16)} ${state.padEnd(8)} last used: ${k.last_used_at ?? "never"}`,
	);
}
console.log();
