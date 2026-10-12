import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatter } from "@lingui/format-po";
import type { ColorTokens } from "@rakazo/ui-tokens";
import { cssVariableName, darkTokens, lightTokens } from "@rakazo/ui-tokens";
import { readBrandDirSetting } from "./env";

export const UPSTREAM_PRODUCT_NAME = "Rakazo";

const SOURCE_LOCALE = "en";
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 300;
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_TOKEN_KEYS = new Set(Object.keys(darkTokens));
const SCANNED_EXTENSIONS = new Set([
  ".js",
  ".css",
  ".html",
  ".webmanifest",
  ".json",
  ".svg",
  ".txt",
]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class BrandOverlayError extends Error {
  constructor(message: string) {
    super(`Brand overlay: ${message}`);
    this.name = "BrandOverlayError";
  }
}

type PublicFileRule =
  | { readonly kind: "png"; readonly size: number }
  | { readonly kind: "ico" }
  | { readonly kind: "manifest" };

export const BRANDABLE_PUBLIC_FILES: ReadonlyMap<string, PublicFileRule> = new Map([
  ["apple-touch-icon.png", { kind: "png", size: 180 }],
  ["favicon-16x16.png", { kind: "png", size: 16 }],
  ["favicon-32x32.png", { kind: "png", size: 32 }],
  ["favicon.ico", { kind: "ico" }],
  ["favicon.png", { kind: "png", size: 128 }],
  ["icon-192.png", { kind: "png", size: 192 }],
  ["icon-512.png", { kind: "png", size: 512 }],
  ["site.webmanifest", { kind: "manifest" }],
]);

export const PUBLIC_FILE_CONTENT_TYPES = {
  png: "image/png",
  ico: "image/x-icon",
  manifest: "application/manifest+json",
} as const satisfies Record<PublicFileRule["kind"], string>;

export type BrandColors = { dark: Partial<ColorTokens>; light: Partial<ColorTokens> };

export type BrandStrings = Record<string, Record<string, string>>;

export type Brand = {
  name: string;
  description: string;
  colors: BrandColors;
  strings: BrandStrings;
  publicFiles: ReadonlyMap<string, string>;
};

export function resolveBrandDir(env: NodeJS.ProcessEnv, repoRoot: string): string | undefined {
  const setting = readBrandDirSetting(env);
  return setting ? path.resolve(repoRoot, setting) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new BrandOverlayError(`cannot read ${file}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new BrandOverlayError(`${file} is not valid JSON: ${(error as Error).message}`);
  }
}

function rejectUnknownKeys(where: string, value: Record<string, unknown>, allowed: string[]) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new BrandOverlayError(`${where} has unknown keys: ${unknown.join(", ")}`);
  }
}

function readText(where: string, value: unknown, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new BrandOverlayError(`${where} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new BrandOverlayError(`${where} must be at most ${maxLength} characters`);
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new BrandOverlayError(`${where} must not contain control characters`);
  }
  if (text.includes(UPSTREAM_PRODUCT_NAME)) {
    throw new BrandOverlayError(`${where} must not contain "${UPSTREAM_PRODUCT_NAME}"`);
  }
  return text;
}

function parseColorTheme(where: string, value: unknown): Partial<ColorTokens> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new BrandOverlayError(`${where} must be an object`);
  const theme: Partial<Record<keyof ColorTokens, string>> = {};
  for (const [key, color] of Object.entries(value)) {
    if (!COLOR_TOKEN_KEYS.has(key)) {
      throw new BrandOverlayError(`${where} has unknown colour token "${key}"`);
    }
    if (typeof color !== "string" || !HEX_COLOR.test(color)) {
      throw new BrandOverlayError(`${where}.${key} must be a hex colour like #1a2b3c`);
    }
    theme[key as keyof ColorTokens] = color.toLowerCase();
  }
  return theme;
}

export function parseBrandConfig(raw: unknown): Pick<Brand, "name" | "description" | "colors"> {
  if (!isRecord(raw)) throw new BrandOverlayError("brand.json must be an object");
  rejectUnknownKeys("brand.json", raw, ["name", "description", "colors"]);
  const colors = raw.colors ?? {};
  if (!isRecord(colors)) throw new BrandOverlayError("brand.json colors must be an object");
  rejectUnknownKeys("brand.json colors", colors, ["dark", "light"]);
  return {
    name: readText("brand.json name", raw.name, MAX_NAME_LENGTH),
    description: readText("brand.json description", raw.description, MAX_DESCRIPTION_LENGTH),
    colors: {
      dark: parseColorTheme("brand.json colors.dark", colors.dark),
      light: parseColorTheme("brand.json colors.light", colors.light),
    },
  };
}

export function parseBrandStrings(raw: unknown): BrandStrings {
  if (!isRecord(raw)) throw new BrandOverlayError("strings.json must be an object");
  const strings: BrandStrings = {};
  for (const [locale, overrides] of Object.entries(raw)) {
    if (!isRecord(overrides)) {
      throw new BrandOverlayError(`strings.json "${locale}" must be an object`);
    }
    const entries: Record<string, string> = {};
    for (const [msgid, msgstr] of Object.entries(overrides)) {
      if (typeof msgstr !== "string" || !msgstr) {
        throw new BrandOverlayError(
          `strings.json "${locale}" override for ${JSON.stringify(msgid)} must be a non-empty string`,
        );
      }
      entries[msgid] = msgstr;
    }
    strings[locale] = entries;
  }
  return strings;
}

function pngSize(bytes: Buffer): number | undefined {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  if (bytes.toString("latin1", 12, 16) !== "IHDR") return undefined;
  const width = bytes.readUInt32BE(16);
  return width === bytes.readUInt32BE(20) ? width : undefined;
}

function validatePublicFile(name: string, rule: PublicFileRule, file: string) {
  const bytes = readFileSync(file);
  if (rule.kind === "png") {
    const size = pngSize(bytes);
    if (size !== rule.size) {
      throw new BrandOverlayError(
        `public/${name} must be a ${rule.size}x${rule.size} PNG${size ? `, got ${size}x${size}` : ""}`,
      );
    }
  } else if (rule.kind === "ico") {
    const isIco =
      bytes.length >= 6 &&
      bytes.readUInt16LE(0) === 0 &&
      bytes.readUInt16LE(2) === 1 &&
      bytes.readUInt16LE(4) > 0;
    if (!isIco) throw new BrandOverlayError(`public/${name} must be an ICO file`);
  } else {
    let manifest: unknown;
    try {
      manifest = JSON.parse(bytes.toString("utf8"));
    } catch {
      manifest = undefined;
    }
    if (!isRecord(manifest)) throw new BrandOverlayError(`public/${name} must be a JSON object`);
  }
}

export function loadBrandPublicFiles(publicDir: string): ReadonlyMap<string, string> {
  if (!existsSync(publicDir) || !statSync(publicDir).isDirectory()) {
    throw new BrandOverlayError(`${publicDir} must be a directory`);
  }
  const files = new Map<string, string>();
  const unknown: string[] = [];
  for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isFile() || !BRANDABLE_PUBLIC_FILES.has(entry.name)) {
      unknown.push(entry.name);
      continue;
    }
    files.set(entry.name, path.join(publicDir, entry.name));
  }
  if (unknown.length) {
    throw new BrandOverlayError(
      `public/ may only contain ${[...BRANDABLE_PUBLIC_FILES.keys()].join(", ")}; found ${unknown.join(", ")}`,
    );
  }
  const missing = [...BRANDABLE_PUBLIC_FILES.keys()].filter((name) => !files.has(name));
  if (missing.length) throw new BrandOverlayError(`public/ is missing ${missing.join(", ")}`);
  for (const [name, rule] of BRANDABLE_PUBLIC_FILES)
    validatePublicFile(name, rule, files.get(name)!);
  return files;
}

export function loadBrand(dir: string): Brand {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new BrandOverlayError(`${dir} is not a directory`);
  }
  const stringsFile = path.join(dir, "strings.json");
  return {
    ...parseBrandConfig(readJson(path.join(dir, "brand.json"))),
    strings: existsSync(stringsFile) ? parseBrandStrings(readJson(stringsFile)) : {},
    publicFiles: loadBrandPublicFiles(path.join(dir, "public")),
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replaceExactlyOnce(html: string, find: string, replacement: string): string {
  const index = html.indexOf(find);
  if (index === -1 || html.indexOf(find, index + find.length) !== -1) {
    throw new BrandOverlayError(`index.html must contain exactly one ${find}`);
  }
  return html.slice(0, index) + replacement + html.slice(index + find.length);
}

function replaceTagOnce(html: string, pattern: RegExp, replacement: string, label: string): string {
  const matches = html.match(new RegExp(pattern.source, "g")) ?? [];
  if (matches.length !== 1) {
    throw new BrandOverlayError(`index.html must contain exactly one ${label}`);
  }
  return replaceExactlyOnce(html, matches[0]!, replacement);
}

export function brandIndexHtml(html: string, brand: Brand | undefined): string {
  if (!brand) return html;
  const name = escapeHtml(brand.name);
  let out = replaceTagOnce(html, /<title>[^<]*<\/title>/, `<title>${name}</title>`, "<title>");
  out = replaceTagOnce(
    out,
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapeHtml(brand.description)}" />`,
    "description meta",
  );
  out = replaceTagOnce(
    out,
    /<meta name="apple-mobile-web-app-title" content="[^"]*" \/>/,
    `<meta name="apple-mobile-web-app-title" content="${name}" />`,
    "apple-mobile-web-app-title meta",
  );
  const stockDark = darkTokens.background.toLowerCase();
  const stockLight = lightTokens.background.toLowerCase();
  const dark = brand.colors.dark.background ?? stockDark;
  const light = brand.colors.light.background ?? stockLight;
  if (dark !== stockDark) {
    out = replaceExactlyOnce(
      out,
      `<meta name="theme-color" content="${stockDark}" />`,
      `<meta name="theme-color" content="${dark}" />`,
    );
  }
  if (dark !== stockDark || light !== stockLight) {
    out = replaceExactlyOnce(
      out,
      `theme === "light" ? "${stockLight}" : "${stockDark}"`,
      `theme === "light" ? "${light}" : "${dark}"`,
    );
  }
  return out;
}

function renderOverrideBlock(selector: string, entries: [keyof ColorTokens, string][]): string {
  const lines = entries.map(([token, color]) => `  ${cssVariableName(token)}: ${color};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}

export function renderBrandTokenOverrides(colors: BrandColors): string {
  const darkEntries = Object.entries(colors.dark) as [keyof ColorTokens, string][];
  // `:root` in the dark block also matches in light mode, so the light block restates every
  // token the dark block sets.
  const lightKeys = new Set([
    ...darkEntries.map(([token]) => token),
    ...(Object.keys(colors.light) as (keyof ColorTokens)[]),
  ]);
  const lightEntries = [...lightKeys].map((token): [keyof ColorTokens, string] => [
    token,
    colors.light[token] ?? lightTokens[token].toLowerCase(),
  ]);
  const blocks: string[] = [];
  if (darkEntries.length)
    blocks.push(renderOverrideBlock(':root,\n[data-theme="dark"]', darkEntries));
  if (lightEntries.length) blocks.push(renderOverrideBlock('[data-theme="light"]', lightEntries));
  return blocks.join("\n\n");
}

export function brandTokensCss(css: string, brand: Brand | undefined): string {
  if (!brand) return css;
  const overrides = renderBrandTokenOverrides(brand.colors);
  return overrides ? `${css.trimEnd()}\n\n${overrides}\n` : css;
}

const poFormatter = formatter({ lineNumbers: false });

export type CatalogOverlay = {
  content: string;
  unmatched: string[];
  leftovers: string[];
};

export async function overlayCatalog(
  content: string,
  locale: string,
  overrides: Record<string, string> | undefined,
  filename: string,
): Promise<CatalogOverlay> {
  const context = { locale, sourceLocale: SOURCE_LOCALE, filename };
  const catalog = await poFormatter.parse(content, context);
  const pending = new Set(Object.keys(overrides ?? {}));
  const leftovers: string[] = [];
  for (const [id, message] of Object.entries(catalog)) {
    const msgid = message.message ?? id;
    const override = overrides && Object.hasOwn(overrides, msgid) ? overrides[msgid] : undefined;
    if (override !== undefined) {
      message.translation = override;
      pending.delete(msgid);
    }
    if ((message.translation || msgid).includes(UPSTREAM_PRODUCT_NAME)) leftovers.push(msgid);
  }
  const applied = Object.keys(overrides ?? {}).length > pending.size;
  return {
    content: applied
      ? await poFormatter.serialize(catalog, { ...context, existing: content })
      : content,
    unmatched: [...pending],
    leftovers,
  };
}

export async function writeBrandCatalogs(
  strings: BrandStrings,
  sourceDir: string,
  outDir: string,
): Promise<void> {
  const locales = readdirSync(sourceDir)
    .filter((locale) => existsSync(path.join(sourceDir, locale, "messages.po")))
    .sort();
  const unknownLocales = Object.keys(strings).filter((locale) => !locales.includes(locale));
  if (unknownLocales.length) {
    throw new BrandOverlayError(
      `strings.json has locales with no catalog: ${unknownLocales.join(", ")} (catalogs: ${locales.join(", ")})`,
    );
  }
  const unmatched: string[] = [];
  const leftovers: string[] = [];
  for (const locale of locales) {
    const source = path.join(sourceDir, locale, "messages.po");
    const result = await overlayCatalog(
      readFileSync(source, "utf8"),
      locale,
      strings[locale],
      source,
    );
    unmatched.push(...result.unmatched.map((msgid) => `${locale}: ${JSON.stringify(msgid)}`));
    leftovers.push(...result.leftovers.map((msgid) => `${locale}: ${JSON.stringify(msgid)}`));
    mkdirSync(path.join(outDir, locale), { recursive: true });
    writeFileSync(path.join(outDir, locale, "messages.po"), result.content);
  }
  if (unmatched.length) {
    throw new BrandOverlayError(
      `strings.json overrides msgids that are not in the catalog:\n  ${unmatched.join("\n  ")}`,
    );
  }
  if (leftovers.length) {
    throw new BrandOverlayError(
      `strings.json must override these messages, which still contain "${UPSTREAM_PRODUCT_NAME}":\n  ${leftovers.join("\n  ")}`,
    );
  }
}

export function findUpstreamNameLeftovers(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => SCANNED_EXTENSIONS.has(path.extname(file)))
    .filter((file) => statSync(path.join(dir, file)).isFile())
    .filter((file) => readFileSync(path.join(dir, file), "utf8").includes(UPSTREAM_PRODUCT_NAME))
    .sort();
}
