import esbuild from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const production = process.argv[2] === "production";
const root = process.cwd();

const common = {
  bundle: true,
  target: "es2022",
  sourcemap: production ? false : "inline",
  minify: production,
  keepNames: true,
  logLevel: "info"
};

async function copySqliteAssets() {
  const dist = path.join(root, "node_modules", "@sqlite.org", "sqlite-wasm", "dist");
  const candidates = ["sqlite3.wasm"];
  for (const file of candidates) {
    await fs.copyFile(path.join(dist, file), path.join(root, file));
  }
}

const builds = [
  esbuild.build({
    ...common,
    platform: "node",
    absWorkingDir: root,
    entryPoints: ["./src/main.ts"],
    outfile: path.join(root, "main.js"),
    format: "cjs",
    external: ["obsidian"]
  }),
  esbuild.build({
    ...common,
    platform: "browser",
    absWorkingDir: root,
    entryPoints: ["./src/database/database.worker.ts"],
    outfile: path.join(root, "database.worker.js"),
    format: "iife"
  })
];

await Promise.all(builds);
await copySqliteAssets();

if (!production) {
  const contexts = await Promise.all([
    esbuild.context({
      ...common,
      platform: "node",
      absWorkingDir: root,
      entryPoints: ["./src/main.ts"],
      outfile: path.join(root, "main.js"),
      format: "cjs",
      external: ["obsidian"]
    }),
    esbuild.context({
      ...common,
      platform: "browser",
      absWorkingDir: root,
      entryPoints: ["./src/database/database.worker.ts"],
      outfile: path.join(root, "database.worker.js"),
      format: "iife"
    })
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Watching Scopus Research Explorer...");
}
