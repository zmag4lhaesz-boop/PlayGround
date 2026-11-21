// Minimal static file server for the built game (dist/index.html).
// Foreground process: start.sh runs this directly inside the app-server tmux session.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const root = resolve(process.env.DOC_ROOT || "dist");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const started = process.hrtime.bigint();
  const method = req.method || "GET";
  let status = 500;
  try {
    if (method !== "GET" && method !== "HEAD") {
      status = 405;
      send(res, status, "Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }

    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/healthz") {
      status = 200;
      send(res, status, JSON.stringify({ ok: true, uptime: Math.round(process.uptime()) }), {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }

    let file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      status = 403;
      send(res, status, "Forbidden");
      return;
    }

    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = join(file, "index.html");
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) {
      status = 404;
      send(res, status, "Not Found");
      return;
    }

    const body = await readFile(file);
    status = 200;
    res.writeHead(status, {
      "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error("[serve] request failed:", error);
    if (!res.headersSent) send(res, 500, "Internal Server Error");
    else res.destroy();
  } finally {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`[serve] ${method} ${req.url} -> ${status} ${ms.toFixed(1)}ms`);
  }
});

server.listen(port, host, () => {
  console.log(`[serve] root=${root}`);
  console.log(`[serve] listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`[serve] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
