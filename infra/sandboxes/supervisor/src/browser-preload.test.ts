import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const launcher = fileURLToPath(new URL("../../computer/rakazo-browser", import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeExecutable(file: string, body: string) {
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}

function launchWithPreload(options: { uidResolves: boolean }) {
  const root = mkdtempSync(path.join(tmpdir(), "rakazo-browser-preload-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  const record = path.join(root, "preload");
  mkdirSync(bin);
  writeExecutable(
    path.join(bin, "chromium"),
    `#!/bin/sh\nprintf '%s' "\${LD_PRELOAD-unset}" > '${record}'\n`,
  );
  if (!options.uidResolves) writeExecutable(path.join(bin, "id"), "#!/bin/sh\nexit 1\n");
  const result = spawnSync("sh", [launcher, `--user-data-dir=${path.join(root, "profile")}`], {
    encoding: "utf8",
    timeout: 10_000,
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: path.join(root, "home"),
      DISPLAY: ":7",
      LD_PRELOAD: "/nonexistent/libnss_wrapper.so",
    },
  });
  return { status: result.status, preload: readFileSync(record, "utf8") };
}

describe("browser launcher preload", () => {
  it("starts Chromium without the nss_wrapper preload when the uid resolves", () => {
    expect(launchWithPreload({ uidResolves: true })).toEqual({ status: 0, preload: "unset" });
  });

  it("keeps the preload for a uid that only the wrapper can resolve", () => {
    expect(launchWithPreload({ uidResolves: false })).toEqual({
      status: 0,
      preload: "/nonexistent/libnss_wrapper.so",
    });
  });
});
