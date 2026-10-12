export const SCREEN_VIEWER_STATIC_ENV = "SCREEN_VIEWER_STATIC";

export function isScreenViewerStaticEnabled(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}
