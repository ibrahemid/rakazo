import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findUpstreamNameLeftovers } from "./overlay";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE = path.join(import.meta.dirname, "fixture");
const VITE_BIN = path.join(WEB_ROOT, "node_modules/vite/bin/vite.js");

describe("vite build with the fixture brand", () => {
  let outDir = "";

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(os.tmpdir(), "brand-build-"));
    await promisify(execFile)(
      process.execPath,
      [VITE_BIN, "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
      {
        cwd: WEB_ROOT,
        env: {
          ...process.env,
          NODE_ENV: "production",
          RAKAZO_BRAND_DIR: "apps/web/brand/fixture",
        },
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  }, 180_000);

  afterAll(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("leaves no upstream product name in the bundle", () => {
    expect(existsSync(path.join(outDir, "index.html"))).toBe(true);
    expect(findUpstreamNameLeftovers(outDir)).toEqual([]);
  });

  it("brands the page title and manifest", () => {
    expect(readFileSync(path.join(outDir, "index.html"), "utf8")).toContain(
      "<title>Acme Bots</title>",
    );
    const manifest = JSON.parse(readFileSync(path.join(outDir, "site.webmanifest"), "utf8"));
    expect(manifest.name).toBe("Acme Bots");
  });

  it("ships the brand's icons", () => {
    for (const name of ["favicon.ico", "favicon.png", "icon-512.png"]) {
      expect(readFileSync(path.join(outDir, name))).toEqual(
        readFileSync(path.join(FIXTURE, "public", name)),
      );
    }
  });

  it("applies brand colours after the stock tokens", () => {
    const css = readdirSync(path.join(outDir, "assets"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(path.join(outDir, "assets", file), "utf8"))
      .find((text) => text.includes("--background:#101418"));
    expect(css).toBeDefined();
    expect(css!.lastIndexOf("--background:#101418")).toBeGreaterThan(
      css!.lastIndexOf("--background:#0b0c0e"),
    );
    expect(css!.lastIndexOf("--background:#f6f8fb")).toBeGreaterThan(
      css!.lastIndexOf("--background:#fafaf8"),
    );
  });

  it("uses the brand name for product name literals", () => {
    const appChunks = readdirSync(path.join(outDir, "assets"))
      .filter((file) => file.endsWith(".js") && !file.startsWith("messages-"))
      .map((file) => readFileSync(path.join(outDir, "assets", file), "utf8"));
    expect(appChunks.some((text) => text.includes("Acme Bots"))).toBe(true);
    expect(appChunks.some((text) => text.includes("__PRODUCT_NAME__"))).toBe(false);
  });
});
