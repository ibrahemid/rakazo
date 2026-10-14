import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const computerDir = new URL("../../computer/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, computerDir), "utf8");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function launchArgs(): string[] {
  const root = mkdtempSync(path.join(tmpdir(), "rakazo-browser-flags-"));
  roots.push(root);
  const bin = path.join(root, "bin");
  const record = path.join(root, "argv");
  mkdirSync(bin);
  const chromium = path.join(bin, "chromium");
  writeFileSync(
    chromium,
    `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg"; done > '${record}'\n`,
  );
  chmodSync(chromium, 0o755);
  const result = spawnSync(
    "sh",
    [
      fileURLToPath(new URL("rakazo-browser", computerDir)),
      `--user-data-dir=${path.join(root, "profile")}`,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: path.join(root, "home"), DISPLAY: ":7" },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return readFileSync(record, "utf8").split("\n").filter(Boolean);
}

describe("computer image Chromium background traffic", () => {
  it("installs a managed policy that turns off Google background services", () => {
    const policy = JSON.parse(read("chromium-policy.json")) as Record<string, unknown>;
    expect(policy).toMatchObject({
      BackgroundModeEnabled: false,
      BrowserNetworkTimeQueriesEnabled: false,
      ComponentUpdatesEnabled: false,
      DomainReliabilityAllowed: false,
      MetricsReportingEnabled: false,
      NetworkPredictionOptions: 2,
      SafeBrowsingProtectionLevel: 0,
      SearchSuggestEnabled: false,
      SpellCheckServiceEnabled: false,
      SyncDisabled: true,
      TranslateEnabled: false,
      UrlKeyedAnonymizedDataCollectionEnabled: false,
    });
    const dockerfile = read("Dockerfile").split("\n");
    const mkdir = dockerfile.indexOf("RUN install -d -m 0755 /etc/chromium/policies/managed");
    const copy = dockerfile.indexOf(
      "COPY --chmod=644 chromium-policy.json /etc/chromium/policies/managed/background-services.json",
    );
    expect(mkdir).toBeGreaterThanOrEqual(0);
    expect(copy).toBeGreaterThan(mkdir);
  });

  it("launches Chromium with background networking disabled", () => {
    const flagsLine = read("rakazo-browser")
      .split("\n")
      .find((line) => line.startsWith("FLAGS="));
    expect(flagsLine).toBeDefined();
    for (const flag of [
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-sync",
      "--no-pings",
    ]) {
      expect(flagsLine).toContain(flag);
    }
  });

  it("points the startup Google requests no policy covers away from Google", () => {
    const args = launchArgs();
    expect(args).toEqual(
      expect.arrayContaining([
        "--optimization-guide-manifest-override=/dev/null",
        "--disable-features=AimEnabled,AutofillServerCommunication",
        "--gcm-checkin-url=http://127.0.0.1:9/checkin",
        "--gcm-registration-url=http://127.0.0.1:9/register3",
        "--gcm-mcs-endpoint=https://127.0.0.1:9",
      ]),
    );
    const prefix = "--gaia-config-contents=";
    const gaia = args.filter((arg) => arg.startsWith(prefix));
    expect(gaia).toHaveLength(1);
    expect(JSON.parse(gaia[0]?.slice(prefix.length) ?? "")).toEqual({
      urls: { list_accounts_url: { url: "http://127.0.0.1:9/ListAccounts" } },
    });
  });
});
