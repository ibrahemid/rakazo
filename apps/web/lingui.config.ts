import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";
import { BRAND_BUILD_DIRNAME, readBrandDirSetting } from "./brand/env";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "ko", "tr", "hi", "pt-BR", "zh-CN", "es", "ru", "fr", "he"],
  catalogs: [
    {
      path: readBrandDirSetting(process.env)
        ? `<rootDir>/${BRAND_BUILD_DIRNAME}/locales/{locale}/messages`
        : "<rootDir>/src/locales/{locale}/messages",
      include: ["src"],
      exclude: ["**/locales/**", "**/*.test.*"],
    },
  ],
  compileNamespace: "es",
  // Keep file paths in `#:` origins, but drop line numbers. A shift in a large
  // source file otherwise rewrites the same reference in every locale catalog.
  format: formatter({ lineNumbers: false }),
});
