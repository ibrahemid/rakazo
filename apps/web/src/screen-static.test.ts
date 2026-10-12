import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertStaticViewerTree,
  readScreenViewerStaticFlag,
  resolveStaticViewerPath,
  ScreenViewerStaticError,
  serveStaticViewer,
  staticViewerContentType,
  staticViewerRequestPath,
} from "./screen-static.js";

const EMBED_HTML = "<!DOCTYPE html><title>viewer</title>";
const RFB_JS = "export default class RFB {}";
const SESSION = "/novnc/session/view/1700000000000.token_-abc";

describe("SCREEN_VIEWER_STATIC flag", () => {
  it("is off unless set to 1 or true", () => {
    for (const value of [undefined, "", "0", "false", "no", "yes", "on", "2"]) {
      expect(readScreenViewerStaticFlag({ SCREEN_VIEWER_STATIC: value })).toBe(false);
    }
    expect(readScreenViewerStaticFlag({})).toBe(false);
  });

  it("is on for 1 and true", () => {
    for (const value of ["1", "true", "TRUE", " true "]) {
      expect(readScreenViewerStaticFlag({ SCREEN_VIEWER_STATIC: value })).toBe(true);
    }
  });
});

describe("staticViewerRequestPath", () => {
  it("returns the file path after the capability and strips the query", () => {
    expect(staticViewerRequestPath(`${SESSION}/embed.html?autoconnect=true&path=websockify`)).toBe(
      "embed.html",
    );
    expect(
      staticViewerRequestPath("/novnc/session/control/1700000000000.token/core/rfb.js?v=1"),
    ).toBe("core/rfb.js");
  });

  it("ignores URLs outside the session pattern", () => {
    expect(staticViewerRequestPath(undefined)).toBeNull();
    expect(staticViewerRequestPath("/novnc/vnc.html")).toBeNull();
    expect(staticViewerRequestPath("/novnc/session/view/token")).toBeNull();
    expect(staticViewerRequestPath("/novnc/session/admin/token/embed.html")).toBeNull();
    expect(staticViewerRequestPath("/novnc/old/view/token/embed.html")).toBeNull();
  });
});

describe("resolveStaticViewerPath", () => {
  const root = path.resolve("/srv/viewer");

  it("resolves files inside the root", () => {
    expect(resolveStaticViewerPath(root, "embed.html")).toBe(path.join(root, "embed.html"));
    expect(resolveStaticViewerPath(root, "core/rfb.js")).toBe(path.join(root, "core", "rfb.js"));
    expect(resolveStaticViewerPath(root, "core%2Frfb.js")).toBe(path.join(root, "core", "rfb.js"));
  });

  it.each([
    ["parent segment", "../secret"],
    ["nested parent segment", "core/../../secret"],
    ["encoded parent segment", "%2e%2e/secret"],
    ["encoded parent and separator", "%2E%2E%2Fsecret"],
    ["dot segment", "./embed.html"],
    ["absolute path", "/etc/passwd"],
    ["encoded absolute path", "%2Fetc%2Fpasswd"],
    ["windows absolute path", "C:/Windows/win.ini"],
    ["backslash", "core%5C..%5C..%5Csecret"],
    ["NUL byte", "embed.html%00.js"],
    ["raw NUL byte", "embed.html\0.js"],
    ["malformed escape", "%E0%A4%A"],
    ["empty path", ""],
    ["directory", "core/"],
    ["empty segment", "core//rfb.js"],
  ])("rejects %s", (_name, requested) => {
    expect(resolveStaticViewerPath(root, requested)).toBeNull();
  });
});

describe("staticViewerContentType", () => {
  it.each([
    ["embed.html", "text/html; charset=utf-8"],
    ["core/rfb.js", "text/javascript; charset=utf-8"],
    ["module.mjs", "text/javascript; charset=utf-8"],
    ["app/styles/base.css", "text/css; charset=utf-8"],
    ["app/images/icon.svg", "image/svg+xml"],
    ["app/images/icon.png", "image/png"],
    ["favicon.ico", "image/x-icon"],
    ["font.woff", "font/woff"],
    ["font.woff2", "font/woff2"],
    ["app/locale/de.json", "application/json; charset=utf-8"],
    ["decoder.wasm", "application/wasm"],
    ["core/rfb.js.map", "application/json; charset=utf-8"],
    ["EMBED.HTML", "text/html; charset=utf-8"],
    ["app/sounds/bell.oga", "application/octet-stream"],
  ])("maps %s to %s", (file, type) => {
    expect(staticViewerContentType(file)).toBe(type);
  });
});

describe("serveStaticViewer", () => {
  let base: string;
  let root: string;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "screen-static-"));
    root = path.join(base, "novnc-static");
    await mkdir(path.join(root, "core"), { recursive: true });
    await writeFile(path.join(root, "embed.html"), EMBED_HTML);
    await writeFile(path.join(root, "core", "rfb.js"), RFB_JS);
    await writeFile(path.join(base, "secret.txt"), "outside");
    await symlink("embed.html", path.join(root, "vnc_auto.html"));
    await symlink(base, path.join(root, "escape"));
    server = http.createServer((req, res) => {
      const filePath = staticViewerRequestPath(req.url);
      if (filePath === null) {
        res.statusCode = 418;
        res.end();
        return;
      }
      void serveStaticViewer(req, res, root, filePath);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(base, { recursive: true, force: true });
  });

  function request(method: string, rawPath: string) {
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>(
      (resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method, path: rawPath }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          res.on("error", reject);
        });
        req.on("error", reject);
        req.end();
      },
    );
  }

  it("serves embed.html with the same-origin header set", async () => {
    const response = await request("GET", `${SESSION}/embed.html?autoconnect=true&path=websockify`);
    expect(response.status).toBe(200);
    expect(response.body).toBe(EMBED_HTML);
    expect(response.headers).toMatchObject({
      "content-type": "text/html; charset=utf-8",
      "content-length": String(Buffer.byteLength(EMBED_HTML)),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "content-security-policy": "frame-ancestors 'self'",
      "cross-origin-resource-policy": "same-origin",
    });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).not.toContain("sandbox");
  });

  it("serves core/rfb.js as JavaScript", async () => {
    const response = await request("GET", `${SESSION}/core/rfb.js`);
    expect(response.status).toBe(200);
    expect(response.body).toBe(RFB_JS);
    expect(response.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("strips the query string before lookup", async () => {
    const response = await request("GET", `${SESSION}/core/rfb.js?v=../../secret.txt`);
    expect(response.status).toBe(200);
    expect(response.body).toBe(RFB_JS);
  });

  it("answers HEAD with headers only", async () => {
    const response = await request("HEAD", `${SESSION}/core/rfb.js`);
    expect(response.status).toBe(200);
    expect(response.body).toBe("");
    expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(RFB_JS)));
  });

  it("returns 404 for a missing file", async () => {
    const response = await request("GET", `${SESSION}/core/missing.js`);
    expect(response.status).toBe(404);
    expect(response.body).toBe("Not found");
  });

  it.each([
    ["a directory", `${SESSION}/core`],
    ["a parent segment", `${SESSION}/../secret.txt`],
    ["an encoded parent segment", `${SESSION}/%2e%2e/secret.txt`],
    ["an encoded absolute path", `${SESSION}/${encodeURIComponent(path.join(os.tmpdir(), "x"))}`],
    ["a NUL byte", `${SESSION}/embed.html%00`],
    ["a symlinked file", `${SESSION}/vnc_auto.html`],
    ["a symlinked directory that leaves the root", `${SESSION}/escape/secret.txt`],
    ["a malformed escape", `${SESSION}/%E0%A4%A`],
  ])("returns 404 for %s", async (_name, rawPath) => {
    const response = await request("GET", rawPath);
    expect(response.status).toBe(404);
    expect(response.body).toBe("Not found");
  });

  it("returns 405 for POST", async () => {
    const response = await request("POST", `${SESSION}/embed.html`);
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
  });
});

describe("assertStaticViewerTree", () => {
  let base: string;

  beforeAll(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), "screen-static-tree-"));
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("names the variable and the missing path", async () => {
    const root = path.join(base, "partial");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "embed.html"), EMBED_HTML);
    expect(() => assertStaticViewerTree(root)).toThrow(ScreenViewerStaticError);
    expect(() => assertStaticViewerTree(root)).toThrow(
      `SCREEN_VIEWER_STATIC is enabled but ${path.join(root, "core", "rfb.js")} is missing`,
    );
    expect(() => assertStaticViewerTree(path.join(base, "absent"))).toThrow(
      path.join(base, "absent", "embed.html"),
    );
  });

  it("accepts a tree with the viewer and its RFB client", async () => {
    const root = path.join(base, "complete");
    await mkdir(path.join(root, "core"), { recursive: true });
    await writeFile(path.join(root, "embed.html"), EMBED_HTML);
    await writeFile(path.join(root, "core", "rfb.js"), RFB_JS);
    expect(() => assertStaticViewerTree(root)).not.toThrow();
  });
});
