import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { darkTokens, lightTokens } from "@rakazo/ui-tokens";
import { afterEach, describe, expect, it } from "vitest";
import type { Brand } from "./overlay";
import {
  BrandOverlayError,
  brandIndexHtml,
  brandTokensCss,
  findUpstreamNameLeftovers,
  loadBrand,
  loadBrandPublicFiles,
  overlayCatalog,
  parseBrandConfig,
  renderBrandTokenOverrides,
  resolveBrandDir,
  writeBrandCatalogs,
} from "./overlay";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const FIXTURE = path.join(import.meta.dirname, "fixture");
const SOURCE_CATALOGS = path.join(WEB_ROOT, "src/locales");
const indexHtml = readFileSync(path.join(WEB_ROOT, "index.html"), "utf8");
const stockTokensCss = readFileSync(
  path.resolve(WEB_ROOT, "../../packages/ui-tokens/src/tokens.css"),
  "utf8",
);

const PO = `msgid ""
msgstr ""
"Language: de\\n"

msgid "Sign in to Rakazo"
msgstr "Bei Rakazo anmelden"

msgid "Return to Rakazo"
msgstr ""

msgid "Settings"
msgstr "Einstellungen"
`;

const tempDirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "brand-overlay-"));
  tempDirs.push(dir);
  return dir;
}

function fixtureCopy() {
  const dir = tempDir();
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

function brandWith(overrides: Partial<Brand>): Brand {
  return { ...loadBrand(FIXTURE), ...overrides };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("brand directory setting", () => {
  it("is off when RAKAZO_BRAND_DIR is unset or blank", () => {
    expect(resolveBrandDir({}, "/repo")).toBeUndefined();
    expect(resolveBrandDir({ RAKAZO_BRAND_DIR: "  " }, "/repo")).toBeUndefined();
  });

  it("resolves relative paths against the repository root", () => {
    expect(resolveBrandDir({ RAKAZO_BRAND_DIR: ".brand" }, "/repo")).toBe("/repo/.brand");
    expect(resolveBrandDir({ RAKAZO_BRAND_DIR: "/srv/brand" }, "/repo")).toBe("/srv/brand");
  });
});

describe("without a brand", () => {
  it("leaves index.html, tokens.css and catalogs unchanged", async () => {
    expect(brandIndexHtml(indexHtml, undefined)).toBe(indexHtml);
    expect(brandTokensCss(stockTokensCss, undefined)).toBe(stockTokensCss);
    const result = await overlayCatalog(PO, "de", undefined, "de/messages.po");
    expect(result.content).toBe(PO);
    expect(result.unmatched).toEqual([]);
  });

  it("adds no token overrides for a brand without colours", () => {
    const brand = brandWith({ colors: { dark: {}, light: {} } });
    expect(brandTokensCss(stockTokensCss, brand)).toBe(stockTokensCss);
  });
});

describe("brand.json", () => {
  it("loads the fixture", () => {
    const brand = loadBrand(FIXTURE);
    expect(brand.name).toBe("Acme Bots");
    expect(brand.colors.dark.background).toBe("#101418");
    expect([...brand.publicFiles.keys()].sort()).toEqual([
      "apple-touch-icon.png",
      "favicon-16x16.png",
      "favicon-32x32.png",
      "favicon.ico",
      "favicon.png",
      "icon-192.png",
      "icon-512.png",
      "site.webmanifest",
    ]);
  });

  it("rejects unknown keys, unknown colour tokens and non-hex colours", () => {
    const base = { name: "Acme Bots", description: "Bots." };
    expect(() => parseBrandConfig({ ...base, logo: "x" })).toThrow(/unknown keys: logo/);
    expect(() => parseBrandConfig({ ...base, colors: { dark: { brandPink: "#ff00ff" } } })).toThrow(
      /unknown colour token "brandPink"/,
    );
    expect(() => parseBrandConfig({ ...base, colors: { light: { primary: "red" } } })).toThrow(
      /colors\.light\.primary must be a hex colour/,
    );
    expect(() =>
      parseBrandConfig({ ...base, colors: { dark: { overlay: "rgba(0, 0, 0, 0.5)" } } }),
    ).toThrow(BrandOverlayError);
    expect(() => parseBrandConfig({ ...base, colors: { sepia: {} } })).toThrow(/unknown keys/);
  });

  it("requires a name and description that do not repeat the upstream name", () => {
    expect(() => parseBrandConfig({ name: " ", description: "Bots." })).toThrow(/name/);
    expect(() => parseBrandConfig({ name: "Acme", description: "" })).toThrow(/description/);
    expect(() => parseBrandConfig({ name: "Rakazo Pro", description: "Bots." })).toThrow(
      /must not contain "Rakazo"/,
    );
  });
});

describe("index.html", () => {
  it("brands the title, description, home screen title and theme colours", () => {
    const html = brandIndexHtml(indexHtml, loadBrand(FIXTURE));
    expect(html).toContain("<title>Acme Bots</title>");
    expect(html).toContain('<meta name="description" content="Bots that work for your team." />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Acme Bots" />');
    expect(html).toContain('<meta name="theme-color" content="#101418" />');
    expect(html).toContain('theme === "light" ? "#f6f8fb" : "#101418"');
    expect(html).not.toContain("Rakazo");
  });

  it("escapes the name and keeps stock theme colours when background is not overridden", () => {
    const html = brandIndexHtml(
      indexHtml,
      brandWith({ name: `A&B "$&" <Bots>`, colors: { dark: { primary: "#123456" }, light: {} } }),
    );
    expect(html).toContain("<title>A&amp;B &quot;$&amp;&quot; &lt;Bots&gt;</title>");
    const stockDark = darkTokens.background.toLowerCase();
    const stockLight = lightTokens.background.toLowerCase();
    expect(html).toContain(`<meta name="theme-color" content="${stockDark}" />`);
    expect(html).toContain(`theme === "light" ? "${stockLight}" : "${stockDark}"`);
  });

  it("brands only the light fallback when only the light background changes", () => {
    const html = brandIndexHtml(
      indexHtml,
      brandWith({ colors: { dark: {}, light: { background: "#eeeeee" } } }),
    );
    const stockDark = darkTokens.background.toLowerCase();
    expect(html).toContain(`<meta name="theme-color" content="${stockDark}" />`);
    expect(html).toContain(`theme === "light" ? "#eeeeee" : "${stockDark}"`);
  });

  it("fails when index.html no longer has the expected tags", () => {
    expect(() => brandIndexHtml("<html></html>", loadBrand(FIXTURE))).toThrow(/<title>/);
  });
});

describe("catalog overrides", () => {
  it("replaces exact msgid matches only", async () => {
    const result = await overlayCatalog(
      PO,
      "de",
      { "Sign in to Rakazo": "Bei Acme anmelden", "Return to Rakazo": "Zurück zu Acme" },
      "de/messages.po",
    );
    expect(result.content).toContain('msgid "Sign in to Rakazo"\nmsgstr "Bei Acme anmelden"');
    expect(result.content).toContain('msgid "Return to Rakazo"\nmsgstr "Zurück zu Acme"');
    expect(result.content).toContain('msgid "Settings"\nmsgstr "Einstellungen"');
    expect(result.unmatched).toEqual([]);
    expect(result.leftovers).toEqual([]);
  });

  it("does not match substrings and reports uncovered messages", async () => {
    const result = await overlayCatalog(
      PO,
      "de",
      { "Sign in": "Anmelden", Rakazo: "Acme" },
      "de/messages.po",
    );
    expect(result.unmatched).toEqual(["Sign in", "Rakazo"]);
    expect(result.content).toBe(PO);
    // An empty msgstr falls back to the msgid, which still names the product.
    expect(result.leftovers).toEqual(["Sign in to Rakazo", "Return to Rakazo"]);
  });

  it("writes every catalog with the fixture's strings and no leftovers", async () => {
    const outDir = tempDir();
    await writeBrandCatalogs(loadBrand(FIXTURE).strings, SOURCE_CATALOGS, outDir);
    for (const locale of ["de", "en", "es", "fr", "hi", "ko", "pt-BR", "ru", "tr", "zh-CN"]) {
      const po = readFileSync(path.join(outDir, locale, "messages.po"), "utf8");
      expect(po).toContain("Acme Bots");
      expect(
        po
          .split("\n")
          .filter((line) => line.startsWith("msgstr"))
          .join("\n"),
      ).not.toContain("Rakazo");
    }
  });

  it("lists every (locale, msgid) a brand leaves uncovered", async () => {
    const { strings } = loadBrand(FIXTURE);
    delete strings.ko!["Sign in to Rakazo"];
    await expect(writeBrandCatalogs(strings, SOURCE_CATALOGS, tempDir())).rejects.toThrow(
      /still contain "Rakazo":\n {2}ko: "Sign in to Rakazo"$/,
    );
  });

  it("rejects overrides for unknown locales or msgids", async () => {
    await expect(
      writeBrandCatalogs({ xx: { Settings: "x" } }, SOURCE_CATALOGS, tempDir()),
    ).rejects.toThrow(/locales with no catalog: xx/);
    const { strings } = loadBrand(FIXTURE);
    strings.de!["Sign in to Rakazo!"] = "x";
    await expect(writeBrandCatalogs(strings, SOURCE_CATALOGS, tempDir())).rejects.toThrow(
      /not in the catalog:\n {2}de: "Sign in to Rakazo!"/,
    );
  });
});

describe("colour tokens", () => {
  it("appends dark and light override blocks after the stock tokens", () => {
    const css = brandTokensCss(stockTokensCss, loadBrand(FIXTURE));
    expect(css.startsWith(stockTokensCss.trimEnd())).toBe(true);
    const overrides = css.slice(stockTokensCss.trimEnd().length);
    expect(overrides).toBe(
      [
        "",
        "",
        ':root,\n[data-theme="dark"] {\n  --background: #101418;\n  --primary: #4f8cff;\n}',
        "",
        '[data-theme="light"] {\n  --background: #f6f8fb;\n  --primary: #1f5fd1;\n}',
        "",
      ].join("\n"),
    );
  });

  it("restates the stock light value for tokens only the dark theme overrides", () => {
    expect(
      renderBrandTokenOverrides({ dark: { sidebarAccent: "#ABCDEF" }, light: {} }).split("\n\n"),
    ).toEqual([
      ':root,\n[data-theme="dark"] {\n  --sidebar-accent: #ABCDEF;\n}',
      `[data-theme="light"] {\n  --sidebar-accent: ${lightTokens.sidebarAccent.toLowerCase()};\n}`,
    ]);
  });

  it("lower-cases validated colours", () => {
    expect(
      parseBrandConfig({ name: "A", description: "B", colors: { dark: { ring: "#ABC" } } }),
    ).toMatchObject({ colors: { dark: { ring: "#abc" }, light: {} } });
  });
});

describe("public files", () => {
  it("rejects files outside the allowlist", () => {
    const dir = fixtureCopy();
    writeFileSync(path.join(dir, "public/robots.txt"), "");
    expect(() => loadBrand(dir)).toThrow(/found robots\.txt/);
  });

  it("rejects subdirectories", () => {
    const dir = fixtureCopy();
    mkdirSync(path.join(dir, "public/icons"));
    expect(() => loadBrandPublicFiles(path.join(dir, "public"))).toThrow(/found icons/);
  });

  it("ignores dotfiles", () => {
    const dir = fixtureCopy();
    writeFileSync(path.join(dir, "public/.DS_Store"), "");
    expect(loadBrandPublicFiles(path.join(dir, "public")).has(".DS_Store")).toBe(false);
  });

  it("requires every brandable file", () => {
    const dir = fixtureCopy();
    rmSync(path.join(dir, "public/icon-512.png"));
    expect(() => loadBrand(dir)).toThrow(/missing icon-512\.png/);
  });

  it("checks PNG dimensions, the ICO header and the manifest JSON", () => {
    const icons = fixtureCopy();
    cpSync(path.join(icons, "public/favicon.png"), path.join(icons, "public/icon-192.png"));
    expect(() => loadBrand(icons)).toThrow(/icon-192\.png must be a 192x192 PNG, got 128x128/);

    const ico = fixtureCopy();
    writeFileSync(path.join(ico, "public/favicon.ico"), "not an icon");
    expect(() => loadBrand(ico)).toThrow(/favicon\.ico must be an ICO file/);

    const manifest = fixtureCopy();
    writeFileSync(path.join(manifest, "public/site.webmanifest"), "[]");
    expect(() => loadBrand(manifest)).toThrow(/site\.webmanifest must be a JSON object/);
  });
});

describe("dist scan", () => {
  it("finds the upstream name in text files only, case-sensitively", () => {
    const dir = tempDir();
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "index.html"), "<title>Acme Bots</title>");
    writeFileSync(path.join(dir, "assets/app.js"), 'const name = "Rakazo";');
    writeFileSync(path.join(dir, "assets/keys.js"), 'const key = "rakazo.uiAppearance";');
    writeFileSync(path.join(dir, "icon.png"), "Rakazo");
    writeFileSync(path.join(dir, "site.webmanifest"), '{"name":"Rakazo"}');
    expect(findUpstreamNameLeftovers(dir)).toEqual([
      path.join("assets", "app.js"),
      "site.webmanifest",
    ]);
  });
});
