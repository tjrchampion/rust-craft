/**
 * Gzip large JSON API responses when the client supports it. Nitro compresses
 * static assets (compressPublicAssets) but NOT dynamic route responses, so a
 * plain `return { blueprint }` from an event handler ships uncompressed --
 * measured at 1-1.5 MB for a single region blueprint (its full heightmap +
 * assets). That's a real chunk of the region-entry wait, especially over a
 * slow connection, and JSON compresses very well (repetitive numeric arrays).
 * gzip is used over brotli for zero extra dependencies (Node's zlib ships it
 * built in) at a fraction of brotli's CPU cost for a similar ratio here.
 */
import { gzipSync } from "node:zlib";
import { setResponseHeader, type H3Event } from "h3";

/** Below this size, gzip's per-request CPU cost isn't worth the saved bytes. */
const MIN_COMPRESS_BYTES = 4096;

/**
 * Send `payload` as JSON, gzip-compressed when the request's Accept-Encoding
 * allows it and the payload is large enough to be worth compressing. Always
 * sets Vary: Accept-Encoding so caches don't serve the wrong variant.
 */
export function sendCompressedJson(event: H3Event, payload: unknown): Buffer {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, "utf-8");
  setResponseHeader(event, "Content-Type", "application/json; charset=utf-8");
  setResponseHeader(event, "Vary", "Accept-Encoding");

  const acceptEncoding = event.node.req.headers["accept-encoding"];
  const clientAcceptsGzip = (Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : (acceptEncoding ?? "")).includes(
    "gzip",
  );

  if (clientAcceptsGzip && body.byteLength >= MIN_COMPRESS_BYTES) {
    const gz = gzipSync(body, { level: 6 });
    setResponseHeader(event, "Content-Encoding", "gzip");
    return gz;
  }
  return body;
}
