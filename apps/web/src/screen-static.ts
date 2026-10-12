import { constants, statSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, open, realpath } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { isScreenViewerStaticEnabled, SCREEN_VIEWER_STATIC_ENV } from "./lib/screen-viewer-flag.js";

export const SCREEN_VIEWER_STATIC_DIR = "novnc-static";
export const STATIC_VIEWER_REQUIRED_FILES = ["embed.html", "core/rfb.js"] as const;

const SESSION_FILE_PATTERN = /^\/novnc\/session\/(?:view|control)\/[^/]+\/(.*)$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
};

export class ScreenViewerStaticError extends Error {
  override name = "ScreenViewerStaticError";
}

export function readScreenViewerStaticFlag(env: Readonly<Record<string, string | undefined>>) {
  return isScreenViewerStaticEnabled(env[SCREEN_VIEWER_STATIC_ENV]);
}

export function staticViewerRequestPath(url: string | undefined): string | null {
  if (!url) return null;
  const pathname = url.split("?", 1)[0]!;
  return pathname.match(SESSION_FILE_PATTERN)?.[1] ?? null;
}

export function isStaticViewerMethod(method: string | undefined) {
  return method === "GET" || method === "HEAD";
}

export function resolveStaticViewerPath(root: string, requested: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requested);
  } catch {
    return null;
  }
  if (
    decoded === "" ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    path.posix.isAbsolute(decoded) ||
    path.win32.isAbsolute(decoded)
  ) {
    return null;
  }
  const segments = decoded.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return null;
  }
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...segments);
  return resolved.startsWith(`${base}${path.sep}`) ? resolved : null;
}

export function staticViewerContentType(filePath: string) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function staticViewerHeaders(contentType: string, size: number) {
  return {
    "content-type": contentType,
    "content-length": String(size),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "content-security-policy": "frame-ancestors 'self'",
    "cross-origin-resource-policy": "same-origin",
  };
}

export function assertStaticViewerTree(root: string) {
  for (const file of STATIC_VIEWER_REQUIRED_FILES) {
    const filePath = path.join(root, file);
    let present = false;
    try {
      present = statSync(filePath).isFile();
    } catch {
      present = false;
    }
    if (!present) {
      throw new ScreenViewerStaticError(
        `${SCREEN_VIEWER_STATIC_ENV} is enabled but ${filePath} is missing. Build the app image with its noVNC stage or run \`pnpm --filter @rakazo/web novnc:sync\`.`,
      );
    }
  }
}

function sendStaticViewerText(
  res: ServerResponse,
  status: number,
  body: string,
  extraHeaders: Record<string, string> = {},
) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(body);
}

export function rejectStaticViewerMethod(res: ServerResponse) {
  sendStaticViewerText(res, 405, "Method not allowed", { allow: "GET, HEAD" });
}

async function openStaticViewerFile(root: string, requested: string) {
  const candidate = resolveStaticViewerPath(root, requested);
  if (!candidate) return null;
  let handle: FileHandle | undefined;
  try {
    const stats = await lstat(candidate);
    if (!stats.isFile()) return null;
    const realRoot = await realpath(root);
    const expected = path.join(realRoot, path.relative(path.resolve(root), candidate));
    if ((await realpath(candidate)) !== expected) return null;
    handle = await open(expected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile()) {
      await handle.close();
      return null;
    }
    return { handle, path: expected, size: opened.size };
  } catch {
    await handle?.close().catch(() => undefined);
    return null;
  }
}

function errorCode(error: unknown) {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,32}$/.test(code) ? code : "UNKNOWN";
}

export async function serveStaticViewer(
  req: IncomingMessage,
  res: ServerResponse,
  root: string,
  filePath: string,
  onReadError?: (errorCode: string) => void,
): Promise<void> {
  if (!isStaticViewerMethod(req.method)) {
    rejectStaticViewerMethod(res);
    return;
  }
  const file = await openStaticViewerFile(root, filePath);
  if (!file) {
    sendStaticViewerText(res, 404, "Not found");
    return;
  }
  if (res.destroyed) {
    await file.handle.close().catch(() => undefined);
    return;
  }
  res.writeHead(200, staticViewerHeaders(staticViewerContentType(file.path), file.size));
  if (req.method === "HEAD") {
    await file.handle.close().catch(() => undefined);
    res.end();
    return;
  }
  try {
    await pipeline(file.handle.createReadStream(), res);
  } catch (error) {
    await file.handle.close().catch(() => undefined);
    if (res.destroyed && (error as NodeJS.ErrnoException).code === "ERR_STREAM_PREMATURE_CLOSE") {
      return;
    }
    onReadError?.(errorCode(error));
    res.destroy();
  }
}
