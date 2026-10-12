export const BRAND_DIR_ENV = "RAKAZO_BRAND_DIR";

export const BRAND_BUILD_DIRNAME = ".brand";

export function readBrandDirSetting(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[BRAND_DIR_ENV]?.trim();
  return value ? value : undefined;
}
