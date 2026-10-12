import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(new URL("../../../compose/Dockerfile", import.meta.url), "utf8");
const packageManager = (
  JSON.parse(readFileSync(new URL("../../../../package.json", import.meta.url), "utf8")) as {
    packageManager: string;
  }
).packageManager;

describe("application image package manager", () => {
  it("bakes the pinned pnpm into a shared corepack home", () => {
    const lines = dockerfile.split("\n");
    const home = lines.indexOf("ENV COREPACK_HOME=/opt/corepack");
    const prepare = lines.findIndex((line) =>
      line.includes(`corepack prepare ${packageManager} --activate`),
    );
    const install = lines.findIndex((line) => line.startsWith("RUN pnpm install"));
    expect(home).toBeGreaterThanOrEqual(0);
    expect(prepare).toBeGreaterThan(home);
    expect(install).toBeGreaterThan(prepare);
  });

  it("forbids corepack downloads at runtime", () => {
    const lines = dockerfile.split("\n");
    const offline = lines.indexOf("ENV COREPACK_ENABLE_NETWORK=0");
    const lastRun = lines.map((line) => line.startsWith("RUN ")).lastIndexOf(true);
    expect(offline).toBeGreaterThan(lastRun);
  });
});
