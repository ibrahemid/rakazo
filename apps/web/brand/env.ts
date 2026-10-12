export const BRAND_DIR_ENV = "RAKAZO_BRAND_DIR";

/** Generated overlay output, relative to apps/web. */
export const BRAND_BUILD_DIRNAME = ".brand";

/** The raw `RAKAZO_BRAND_DIR` value, or undefined when the overlay is off. */
export function readBrandDirSetting(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[BRAND_DIR_ENV]?.trim();
  return value ? value : undefined;
}
