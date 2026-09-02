// Bundles sites-worker/src/index.ts into a single ESM worker file.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = process.argv[2] ?? resolve(root, "sites-worker/dist/index.js");

export async function bundleWorker(target = outfile) {
  await build({
    entryPoints: [resolve(root, "sites-worker/src/index.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
    outfile: target,
    tsconfig: resolve(root, "sites-worker/tsconfig.json"),
    sourcemap: false,
    minify: false,
    legalComments: "none",
    logLevel: "warning",
  });
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bundleWorker(outfile).then(file => console.log(`worker bundled: ${file}`));
}
