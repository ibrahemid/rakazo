import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";
import { BRAND_BUILD_DIRNAME } from "./env";
import type { Brand } from "./overlay";
import {
  BRANDABLE_PUBLIC_FILES,
  BrandOverlayError,
  brandIndexHtml,
  brandTokensCss,
  findUpstreamNameLeftovers,
  loadBrand,
  PUBLIC_FILE_CONTENT_TYPES,
  resolveBrandDir,
  UPSTREAM_PRODUCT_NAME,
  writeBrandCatalogs,
} from "./overlay";

const PLUGIN_NAME = "rakazo-brand-overlay";
const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const SOURCE_CATALOGS = path.join(WEB_ROOT, "src/locales");
const BRAND_BUILD_DIR = path.join(WEB_ROOT, BRAND_BUILD_DIRNAME);
const BRAND_CATALOGS = path.join(BRAND_BUILD_DIR, "locales");
const BRAND_TOKENS_CSS = path.join(BRAND_BUILD_DIR, "tokens.css");

function stockTokensCssPath() {
  return createRequire(path.join(WEB_ROOT, "package.json")).resolve("@rakazo/ui-tokens/css");
}

/** Redirects `src/locales/<locale>/messages.po` to the generated branded catalog. */
function brandedCatalogPath(source: string, importer: string | undefined): string | undefined {
  if (!importer || !source.endsWith("messages.po")) return undefined;
  const relative = path.relative(SOURCE_CATALOGS, path.resolve(path.dirname(importer), source));
  const parts = relative.split(path.sep);
  if (parts.length !== 2 || parts[0] === ".." || path.isAbsolute(relative)) return undefined;
  return path.join(BRAND_CATALOGS, relative);
}

/**
 * Build-time brand overlay. A no-op unless `RAKAZO_BRAND_DIR` names a brand directory
 * (see docs/branding.md).
 */
export function brandOverlay(): Plugin {
  const brandDir = resolveBrandDir(process.env, REPO_ROOT);
  if (!brandDir) return { name: PLUGIN_NAME };

  let brand: Brand | undefined;
  let prepared: Promise<void> | undefined;
  let outDir = "";
  let written = false;
  const loadedBrand = () => {
    if (!brand) throw new BrandOverlayError("brand used before the config hook loaded it");
    return brand;
  };
  const prepare = async () => {
    const current = loadedBrand();
    rmSync(BRAND_BUILD_DIR, { recursive: true, force: true });
    await writeBrandCatalogs(current.strings, SOURCE_CATALOGS, BRAND_CATALOGS);
    mkdirSync(BRAND_BUILD_DIR, { recursive: true });
    writeFileSync(
      BRAND_TOKENS_CSS,
      brandTokensCss(readFileSync(stockTokensCssPath(), "utf8"), current),
    );
  };

  return {
    name: PLUGIN_NAME,
    enforce: "pre",
    // `vite preview` serves the already-branded dist.
    apply: (_config, env) => !env.isPreview,
    config() {
      brand = loadBrand(brandDir);
      return {
        define: { __PRODUCT_NAME__: JSON.stringify(brand.name) },
        resolve: {
          // Tailwind inlines CSS @imports through vite's resolver, which honours aliases
          // but not plugin resolveId hooks.
          alias: [{ find: /^@rakazo\/ui-tokens\/css$/, replacement: BRAND_TOKENS_CSS }],
        },
      };
    },
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async buildStart() {
      prepared ??= prepare();
      await prepared;
    },
    resolveId(source, importer) {
      return brandedCatalogPath(source, importer);
    },
    transformIndexHtml: {
      order: "pre",
      handler: (html) => brandIndexHtml(html, loadedBrand()),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? "").split("?", 1)[0]!.replace(/^\//, "");
        const file = loadedBrand().publicFiles.get(name);
        const rule = BRANDABLE_PUBLIC_FILES.get(name);
        if (!file || !rule) {
          next();
          return;
        }
        try {
          const body = readFileSync(file);
          res.setHeader("Content-Type", PUBLIC_FILE_CONTENT_TYPES[rule.kind]);
          res.setHeader("Cache-Control", "no-cache");
          res.end(body);
        } catch (error) {
          next(error);
        }
      });
    },
    writeBundle() {
      for (const [name, file] of loadedBrand().publicFiles) {
        copyFileSync(file, path.join(outDir, name));
      }
      written = true;
    },
    closeBundle() {
      // Only after a build wrote dist; a failed build or the dev server has nothing to scan.
      if (!written) return;
      const leftovers = findUpstreamNameLeftovers(outDir);
      if (leftovers.length) {
        throw new BrandOverlayError(
          `the built web app still contains "${UPSTREAM_PRODUCT_NAME}" in:\n  ${leftovers.join("\n  ")}`,
        );
      }
    },
  };
}
