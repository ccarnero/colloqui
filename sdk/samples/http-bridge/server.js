#!/usr/bin/env node
/**
 * Sample: HTTP → platform bridge.
 *
 * A tiny, zero-dependency HTTP server that RECEIVES a message over HTTP and FORWARDS it
 * into the platform's http channel using @yoizen/http-sdk. Any system that can POST JSON
 * can use this as a thin ingress into the platform.
 *
 * Run (from this folder):
 *   pnpm install
 *   YOIZEN_TENANT=acme YOIZEN_EMAIL=ops@acme.com YOIZEN_PASSWORD=••• pnpm start
 *
 * Then:
 *   curl -X POST localhost:4000/messages -H 'content-type: application/json' \
 *     -d '{"from":"customer@example.com","text":"hello"}'
 */
import { createServer } from "node:http";
import {
  createClient,
  SdkError,
  ValidationError,
  ConfigError,
} from "@yoizen/http-sdk";

const PORT = Number(process.env.PORT ?? 4000);
const MAX_BODY_BYTES = 1_000_000;

// Credentials come from YOIZEN_TENANT / YOIZEN_EMAIL / YOIZEN_PASSWORD
// (+ optional YOIZEN_BASE_URL). Fail fast with a clear message if they're missing.
let client;
try {
  client = createClient();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`[bridge] ${err.message}`);
    console.error(
      "[bridge] set YOIZEN_TENANT, YOIZEN_EMAIL and YOIZEN_PASSWORD, then retry.",
    );
    process.exit(1);
  }
  throw err;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new ValidationError("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim().length === 0) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ValidationError("request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Map SDK errors onto sensible HTTP statuses for the bridge's own callers.
function toHttpError(err) {
  if (err instanceof ValidationError) {
    return { status: 400, body: { error: err.message, code: err.code } };
  }
  if (err instanceof SdkError) {
    return {
      status: 502, // the platform call (auth / resolve / ingest) failed
      body: { error: err.message, code: err.code, ingestStatus: err.ingestStatus },
    };
  }
  return { status: 500, body: { error: String(err?.message ?? err) } };
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { status: "ok" });
  }

  if (req.method === "POST" && (req.url === "/messages" || req.url === "/")) {
    try {
      const incoming = await readJsonBody(req);
      console.log(`[bridge] received: ${JSON.stringify(incoming)}`);
      const result = await client.send(incoming);
      console.log(`[bridge] forwarded: ${JSON.stringify(result)}`);
      return sendJson(res, 202, { ok: true, result });
    } catch (err) {
      const { status, body } = toHttpError(err);
      console.error(`[bridge] error (${status}): ${body.error}`);
      return sendJson(res, status, body);
    }
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[bridge] listening on http://localhost:${PORT}`);
  console.log('[bridge] POST /messages  { "text": "...", "from"?: "..." }');
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n[bridge] ${signal} — shutting down`);
    server.close(() => process.exit(0));
  });
}
