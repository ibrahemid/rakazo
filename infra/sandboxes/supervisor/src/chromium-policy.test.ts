import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const computerDir = new URL("../../computer/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, computerDir), "utf8");

describe("computer image Chromium background traffic", () => {
  it("installs a managed policy that turns off Google background services", () => {
    const policy = JSON.parse(read("chromium-policy.json")) as Record<string, unknown>;
    expect(policy).toMatchObject({
      BackgroundModeEnabled: false,
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
});
