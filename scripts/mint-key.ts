import { migrate } from "../src/db/index.js";
import { mintKey } from "../src/auth/keys.js";

/**
 * Usage: pnpm key:mint <project>
 * e.g.   pnpm key:mint cadence
 */
const project = process.argv[2];
if (!project) {
	console.error("Usage: pnpm key:mint <project>   (e.g. pnpm key:mint cadence)");
	process.exit(1);
}

migrate();
const { plaintext, record } = mintKey(project);

console.log("\n✅ New API key minted\n");
console.log(`   project: ${record.project}`);
console.log(`   prefix:  ${record.prefix}`);
console.log(`   key:     ${plaintext}`);
console.log("\n⚠️  This is shown ONCE. Store it in the calling project's secrets now.\n");
console.log(`   Callers send:  Authorization: Bearer ${plaintext}\n`);
