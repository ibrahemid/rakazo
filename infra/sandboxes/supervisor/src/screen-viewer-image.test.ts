import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appLines = readFileSync(
  new URL("../../../compose/Dockerfile", import.meta.url),
  "utf8",
).split("\n");
const computerDockerfile = readFileSync(
  new URL("../../computer/Dockerfile", import.meta.url),
  "utf8",
);
const VIEWER_FILES = ["embed.html", "clipboard-bridge.js", "mobile-keyboard.js"];

function stageRange(name: string) {
  const start = appLines.findIndex((line) => /^FROM\s/.test(line) && line.endsWith(` AS ${name}`));
  const next = appLines.findIndex((line, index) => index > start && /^FROM\s/.test(line));
  return { start, end: next < 0 ? appLines.length : next };
}

describe("application image screen viewer", () => {
  it("builds the noVNC tree on the computer image's pinned Debian base", () => {
    const base = computerDockerfile.match(/^FROM (debian:bookworm-slim@sha256:[0-9a-f]{64})/m)?.[1];
    expect(base).toBeDefined();
    const { start, end } = stageRange("novnc");
    expect(start).toBe(0);
    expect(appLines[start]).toBe(`FROM ${base} AS novnc`);
    const stage = appLines.slice(start, end);
    expect(
      stage.some(
        (line) =>
          line.startsWith("RUN apt-get update && apt-get install -y --no-install-recommends") &&
          /\bnovnc\b/.test(line),
      ),
    ).toBe(true);
    for (const file of VIEWER_FILES) {
      expect(stage).toContain(
        `COPY --chmod=644 infra/sandboxes/computer/${file} /usr/share/novnc/${file}`,
      );
      expect(computerDockerfile).toContain(`COPY --chmod=644 ${file} /usr/share/novnc/${file}`);
    }
  });

  it("copies the tree into the web app after the noVNC stage", () => {
    const copy = appLines.indexOf("COPY --from=novnc /usr/share/novnc /app/apps/web/novnc-static");
    expect(copy).toBeGreaterThan(stageRange("novnc").end);
  });

  it("sets SCREEN_VIEWER_STATIC before the web build so bundle and runtime agree", () => {
    const arg = appLines.indexOf("ARG SCREEN_VIEWER_STATIC=");
    const env = appLines.indexOf("ENV SCREEN_VIEWER_STATIC=$SCREEN_VIEWER_STATIC");
    const build = appLines.findIndex(
      (line) => line.startsWith("RUN ") && line.includes("pnpm --filter @rakazo/web build"),
    );
    expect(arg).toBeGreaterThan(stageRange("novnc").end);
    expect(env).toBeGreaterThan(arg);
    expect(build).toBeGreaterThan(env);
  });
});
