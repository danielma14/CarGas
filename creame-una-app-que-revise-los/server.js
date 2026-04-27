import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicRoot = path.join(__dirname, "public");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function resolveFile(urlPath) {
  const normalizedPath = urlPath === "/" ? "/index.html" : urlPath;
  const decodedPath = decodeURIComponent(normalizedPath);
  const filePath = path.resolve(publicRoot, `.${decodedPath}`);

  if (!filePath.startsWith(publicRoot)) {
    return null;
  }

  return filePath;
}

async function serveFile(response, urlPath) {
  const filePath = resolveFile(urlPath);

  if (!filePath) {
    sendJson(response, 400, { error: "Ruta no valida." });
    return;
  }

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      sendJson(response, 404, { error: "Recurso no encontrado." });
      return;
    }

    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });

    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Recurso no encontrado." });
  }
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Solicitud no valida." });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Metodo no permitido." });
    return;
  }

  if (request.url.startsWith("/api/health")) {
    sendJson(response, 200, { ok: true });
    return;
  }

  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  await serveFile(response, pathname);
});

const port = Number(process.env.PORT || "4173");

server.listen(port, "127.0.0.1", () => {
  console.log(`Servidor listo en http://127.0.0.1:${port}`);
});
