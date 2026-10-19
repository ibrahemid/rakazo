import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readLines = (file: string) =>
  readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8").split("\n");
const computerDockerfile = readFileSync(
  new URL("../../computer/Dockerfile", import.meta.url),
  "utf8",
);
const VIEWER_FILES = ["embed.html", "clipboard-bridge.js", "mobile-keyboard.js"];

function stageRange(lines: string[], name: string) {
  const start = lines.findIndex((line) => /^FROM\s/.test(line) && line.endsWith(` AS ${name}`));
  const next = lines.findIndex((line, index) => index > start && /^FROM\s/.test(line));
  return { start, end: next < 0 ? lines.length : next };
}

describe.each(["compose/Dockerfile", "railway/Dockerfile"])("%s screen viewer", (file) => {
  const appLines = readLines(file);

  it("builds the noVNC tree on the computer image's pinned Debian base", () => {
    const base = computerDockerfile.match(/^FROM (debian:bookworm-slim@sha256:[0-9a-f]{64})/m)?.[1];
    expect(base).toBeDefined();
    const { start, end } = stageRange(appLines, "novnc");
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
    for (const viewerFile of VIEWER_FILES) {
      expect(stage).toContain(
        `COPY --chmod=644 infra/sandboxes/computer/${viewerFile} /usr/share/novnc/${viewerFile}`,
      );
      expect(computerDockerfile).toContain(
        `COPY --chmod=644 ${viewerFile} /usr/share/novnc/${viewerFile}`,
      );
    }
  });

  it("copies the tree into the web app after the noVNC stage", () => {
    const copy = appLines.indexOf("COPY --from=novnc /usr/share/novnc /app/apps/web/novnc-static");
    expect(copy).toBeGreaterThan(stageRange(appLines, "novnc").end);
  });

  it("sets SCREEN_VIEWER_STATIC before the web build so bundle and runtime agree", () => {
    const arg = appLines.indexOf("ARG SCREEN_VIEWER_STATIC=");
    const env = appLines.indexOf("ENV SCREEN_VIEWER_STATIC=$SCREEN_VIEWER_STATIC");
    const build = appLines.findIndex(
      (line) => line.startsWith("RUN ") && line.includes("pnpm --filter @rakazo/web build"),
    );
    expect(arg).toBeGreaterThan(stageRange(appLines, "novnc").end);
    expect(env).toBeGreaterThan(arg);
    expect(build).toBeGreaterThan(env);
  });
});

describe("railway/Dockerfile noVNC stage", () => {
  it("matches the compose image", () => {
    const stage = (file: string) => {
      const lines = readLines(file);
      const { start, end } = stageRange(lines, "novnc");
      return lines.slice(start, end);
    };
    expect(stage("railway/Dockerfile")).toEqual(stage("compose/Dockerfile"));
  });
});
