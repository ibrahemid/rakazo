import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveComputerGeolocation } from "./computer-spec.js";

const computerDir = path.resolve(import.meta.dirname, "../../computer");
const helper = path.join(computerDir, "rakazo-geo");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

function runHelper(args: string[], geolocation: string | undefined) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.RAKAZO_COMPUTER_GEOLOCATION;
  if (geolocation !== undefined) env.RAKAZO_COMPUTER_GEOLOCATION = geolocation;
  return spawnSync("python3", [helper, ...args], { env, encoding: "utf8", timeout: 10_000 });
}

describe.skipIf(!hasPython)("rakazo-geo helper", () => {
  it("prints the parsed position for --check", () => {
    const result = runHelper(["--check"], "52.3676,4.9041");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      latitude: 52.3676,
      longitude: 4.9041,
      accuracy: 50,
    });
    const explicit = runHelper(["--check"], " -33.8688 , 151.2093 , 12.5 ");
    expect(explicit.status, explicit.stderr).toBe(0);
    expect(JSON.parse(explicit.stdout)).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
      accuracy: 12.5,
    });
  });

  it("exits 2 naming the variable for an invalid or missing value", () => {
    for (const value of ["", "91,0", "0,181", "0,0,0", "abc,1", "1_0,4.9", "nan,1", "1,2,3,4"]) {
      const result = runHelper(["--check"], value);
      expect(result.status, value).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toMatch(/RAKAZO_COMPUTER_GEOLOCATION/);
    }
    const unset = runHelper(["--check"], undefined);
    expect(unset.status).toBe(2);
    expect(unset.stderr).toMatch(/RAKAZO_COMPUTER_GEOLOCATION is not set/);
  });

  it("exits 2 for a bad DevTools port before connecting", () => {
    for (const args of [[], ["0"], ["70000"], ["port"], ["9222", "extra"]]) {
      const result = runHelper(args, "52.3676,4.9041");
      expect(result.status, args.join(" ")).toBe(2);
    }
  });

  it("accepts and rejects exactly what the supervisor does", () => {
    for (const value of [
      "52.3676,4.9041",
      "+1e1,-.5,250",
      "90,-180",
      "-90,180,0.1",
      "1.,2.",
      "0,0,1e999",
      "90.0001,0",
      "0x10,4.9",
      "1_0,4.9",
      "Infinity,0",
      " ,4.9",
      "١,4.9",
      "52.3;4.9",
    ]) {
      let expected: unknown;
      try {
        expected = resolveComputerGeolocation(value);
      } catch {
        expected = undefined;
      }
      const result = runHelper(["--check"], value);
      if (expected === undefined) {
        expect(result.status, value).toBe(2);
      } else {
        expect(result.status, `${value}: ${result.stderr}`).toBe(0);
        expect(JSON.parse(result.stdout), value).toEqual(expected);
      }
    }
  });
});

describe("computer image geolocation helper", () => {
  it("installs the helper with its websocket dependency", () => {
    const dockerfile = readFileSync(path.join(computerDir, "Dockerfile"), "utf8");
    expect(dockerfile).toMatch(/^\s+python3-websockets \\$/m);
    expect(dockerfile).toContain("python3 -c 'import websockets;");
    expect(dockerfile.split("\n")).toContain(
      "COPY --chmod=755 rakazo-geo /usr/local/bin/rakazo-geo",
    );
    expect(dockerfile).toMatch(/sed -i 's\/\\r\$\/\/' [^\n]*\/usr\/local\/bin\/rakazo-geo/);
  });
});

describe.skipIf(process.platform === "win32")("rakazo-browser geolocation helper launch", () => {
  const display = 97;
  const port = 9221 + display;
  const pidfile = `/tmp/rakazo/geo-${port}.pid`;
  const logfile = `/tmp/rakazo/geo-${port}.log`;

  const waitFor = async (file: string) => {
    for (let attempt = 0; attempt < 500 && !existsSync(file); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  const stopHelper = () => {
    const pid = Number(existsSync(pidfile) ? readFileSync(pidfile, "utf8").trim() : "");
    if (Number.isSafeInteger(pid) && pid > 0) spawnSync("kill", [String(pid)]);
    rmSync(pidfile, { force: true });
    rmSync(logfile, { force: true });
  };

  it("starts one detached helper on the browser's DevTools port only when configured", async () => {
    const createdRuntimeDir = !existsSync("/tmp/rakazo");
    const temp = mkdtempSync(path.join(tmpdir(), "rakazo-browser-geo-"));
    const bin = path.join(temp, "bin");
    const home = path.join(temp, "home");
    const chromiumArgs = path.join(temp, "chromium-args");
    const helperCalls = path.join(temp, "helper-calls");
    mkdirSync(bin);
    copyFileSync(path.join(computerDir, "rakazo-browser"), path.join(temp, "rakazo-browser"));
    writeFileSync(
      path.join(bin, "chromium"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$RAKAZO_TEST_CHROMIUM_ARGS"\n',
    );
    writeFileSync(
      path.join(temp, "rakazo-geo"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$RAKAZO_TEST_HELPER_CALLS"',
        "sleep 30 &",
        "child=$!",
        "trap 'kill \"$child\"; exit 0' TERM",
        'wait "$child"',
        "",
      ].join("\n"),
    );
    chmodSync(path.join(bin, "chromium"), 0o755);
    chmodSync(path.join(temp, "rakazo-geo"), 0o755);

    const launch = (geolocation: string) => {
      rmSync(chromiumArgs, { force: true });
      const result = spawnSync("sh", [path.join(temp, "rakazo-browser")], {
        env: {
          ...process.env,
          DISPLAY: `:${display}`,
          HOME: home,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
          RAKAZO_COMPUTER_GEOLOCATION: geolocation,
          RAKAZO_TEST_CHROMIUM_ARGS: chromiumArgs,
          RAKAZO_TEST_HELPER_CALLS: helperCalls,
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(chromiumArgs, "utf8")).toContain(`--remote-debugging-port=${port}`);
    };

    stopHelper();
    try {
      launch("");
      expect(existsSync(pidfile)).toBe(false);
      expect(existsSync(helperCalls)).toBe(false);

      launch("52.3676,4.9041");
      await waitFor(helperCalls);
      expect(readFileSync(helperCalls, "utf8")).toBe(`${port}\n`);
      expect(Number(readFileSync(pidfile, "utf8").trim())).toBeGreaterThan(0);

      if (process.platform === "linux") {
        launch("52.3676,4.9041");
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(readFileSync(helperCalls, "utf8")).toBe(`${port}\n`);
      }
    } finally {
      stopHelper();
      rmSync(temp, { recursive: true, force: true });
      if (createdRuntimeDir) rmSync("/tmp/rakazo", { recursive: true, force: true });
    }
  });
});
