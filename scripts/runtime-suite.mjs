import { spawnSync } from "node:child_process";
import path from "node:path";

const scripts = [
  "cdp-smoke.mjs",
  "cdp-contract.mjs",
  "cdp-restore.mjs",
  "cdp-performance.mjs"
];
let failure = 0;
try {
  for (const script of scripts) {
    console.log(`\n=== ${script} ===`);
    const result = spawnSync(process.execPath, [path.resolve("scripts", script)], {
      stdio: "inherit",
      env: process.env
    });
    if (result.status !== 0) {
      failure = result.status ?? 1;
      break;
    }
  }
} finally {
  console.log("\n=== cdp-cleanup.mjs ===");
  const cleanup = spawnSync(process.execPath, [path.resolve("scripts", "cdp-cleanup.mjs")], {
    stdio: "inherit",
    env: process.env
  });
  if (cleanup.status !== 0 && failure === 0) failure = cleanup.status ?? 1;
}
process.exitCode = failure;
