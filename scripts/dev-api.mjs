#!/usr/bin/env node
/**
 * Local runner for the worker. Bundles sites-worker/src with esbuild, provides
 * a D1-compatible binding backed by node:sqlite, injects a signed-in viewer
 * header (the hosting platform does this in production), and serves the API
 * on http://localhost:8787. If apps/web/out exists it is served as ASSETS,
 * so `pnpm build && pnpm dev:api` gives a production-like single origin.
 *
 * Env: PORT (8787), FINTWIN_DB (./data/local.sqlite; ":memory:" for tests),
 *      GROQ_API_KEY etc. are forwarded to the worker.
 */
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleWorker } from "./bundle-worker.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Load ./.env (gitignored) so local secrets never need to be exported by hand.
try {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }
const port = Number(process.env.PORT || 8787);
const dbPath = process.env.FINTWIN_DB || join(root, "data", "local.sqlite");
const viewerId = process.env.FINTWIN_VIEWER || "local-dev-user";
// Hosted mode (FINTWIN_IDENTITY=cookie): each browser gets its own private account via cookie.
const cookieIdentity = process.env.FINTWIN_IDENTITY === "cookie";

// --- D1 shim ---------------------------------------------------------------
function d1(database) {
  const statement = (sql) => {
    let params = [];
    const api = {
      bind(...values) { params = values.map(value => value === undefined ? null : value); return api; },
      async first() { return database.prepare(sql).get(...params) ?? null; },
      async all() { return { results: database.prepare(sql).all(...params) }; },
      async run() { const info = database.prepare(sql).run(...params); return { success: true, meta: info }; },
      _sql: sql,
    };
    return api;
  };
  return { prepare: statement, async batch(statements) { const results = []; for (const item of statements) results.push(await item.run()); return results; } };
}

if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
const database = new DatabaseSync(dbPath);
database.exec("PRAGMA journal_mode = WAL");

// --- static assets -----------------------------------------------------------
const outDir = join(root, "apps", "web", "out");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2", ".woff": "font/woff" };
const assets = {
  async fetch(request) {
    if (!existsSync(outDir)) return new Response("Not found", { status: 404 });
    const url = new URL(request.url);
    let file = join(outDir, decodeURIComponent(url.pathname));
    if (!file.startsWith(outDir)) return new Response("Forbidden", { status: 403 });
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`;
    if (!existsSync(file)) return new Response("Not found", { status: 404 });
    return new Response(readFileSync(file), { headers: { "content-type": mime[extname(file)] || "application/octet-stream" } });
  },
};

const env = { DB: d1(database), ASSETS: assets, GROQ_API_KEY: process.env.GROQ_API_KEY, GROQ_CHAT_MODEL: process.env.GROQ_CHAT_MODEL, GROQ_TTS_MODEL: process.env.GROQ_TTS_MODEL, GROQ_TTS_VOICE: process.env.GROQ_TTS_VOICE };

const bundle = await bundleWorker(join(root, "sites-worker", "dist", "index.mjs"));
const worker = (await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`)).default;

const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
  // Identity: platform headers if present; otherwise a per-browser cookie (or the fixed
  // local viewer when FINTWIN_VIEWER is set, which is the default for local development).
  let setCookie = null;
  if (!headers.has("oai-authenticated-user-id")) {
    if (cookieIdentity) {
      const cookies = Object.fromEntries((req.headers.cookie || "").split(";").map(part => part.trim().split("=")).filter(pair => pair.length === 2));
      let id = cookies.fintwin_viewer;
      if (!id || !/^[a-f0-9-]{36}$/.test(id)) { id = crypto.randomUUID(); setCookie = `fintwin_viewer=${id}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`; }
      headers.set("oai-authenticated-user-id", id);
    } else { headers.set("oai-authenticated-user-id", viewerId); headers.set("oai-authenticated-user-email", `${viewerId}@example.local`); }
  }
  const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  try {
    const response = await worker.fetch(request, env);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    if (setCookie) responseHeaders["set-cookie"] = setCookie;
    res.writeHead(response.status, responseHeaders);
    if (!response.body) { res.end(); return; }
    const reader = response.body.getReader();
    while (true) { const { value, done } = await reader.read(); if (done) break; res.write(value); }
    res.end();
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, () => {
  console.log(`FinTwin API on http://localhost:${port}  (db: ${dbPath}, identity: ${cookieIdentity ? "cookie" : viewerId}, model: ${env.GROQ_API_KEY ? "groq live" : "offline companion"}${existsSync(outDir) ? ", serving apps/web/out" : ""})`);
});
