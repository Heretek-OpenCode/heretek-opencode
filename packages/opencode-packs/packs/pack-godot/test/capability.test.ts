import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generateCapabilities,
  readCapabilities,
  validateHttpCapability,
  validateWsCapability,
  writeCapabilities,
} from "../src/security/capability";

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup noise
    }
  }
});

function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "godot-cap-"));
  chmodSync(dir, 0o700);
  scratch.push(dir);
  return dir;
}

describe("capability manager", () => {
  test("generates dual independent 32-byte tokens", () => {
    const caps = generateCapabilities();
    expect(validateHttpCapability(caps.httpCapability)).toBe(
      caps.httpCapability,
    );
    expect(validateWsCapability(caps.wsCapability)).toBe(caps.wsCapability);
    expect(caps.httpCapability).not.toBe(caps.wsCapability);
    expect(caps.wsCapability).toMatch(/^[0-9a-f]{64}$/);
  });

  test("round-trips through atomic 0600 record", () => {
    const dir = sandbox();
    const caps = generateCapabilities();
    const path = writeCapabilities(9500, caps, dir);
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    const back = readCapabilities(9500, dir);
    expect(back).toEqual(caps);
  });

  test("chmod 0666 record is rejected on read", () => {
    const dir = sandbox();
    const caps = generateCapabilities();
    const path = writeCapabilities(9501, caps, dir);
    chmodSync(path, 0o666);
    expect(readCapabilities(9501, dir)).toBeNull();
  });

  test("group-writable ancestor directory is rejected", () => {
    const dir = sandbox();
    chmodSync(dir, 0o775);
    const caps = generateCapabilities();
    expect(() => writeCapabilities(9502, caps, dir)).toThrow();
    expect(readCapabilities(9502, dir)).toBeNull();
  });

  test("symlinked capability path is rejected", () => {
    const dir = sandbox();
    const real = join(dir, "real");
    const link = join(dir, "link");
    const caps = generateCapabilities();
    writeCapabilities(9503, caps, real);
    symlinkSync(real, link);
    expect(readCapabilities(9503, link)).toBeNull();
  });

  test("symlinked ancestor component is rejected", () => {
    const dir = sandbox();
    const target = sandbox();
    const linkParent = join(dir, "evildir");
    symlinkSync(target, linkParent);
    const caps = generateCapabilities();
    expect(() =>
      writeCapabilities(9504, caps, join(linkParent, "sub")),
    ).toThrow();
  });

  test("world-writable file planted by attacker is not trusted", () => {
    const dir = sandbox();
    writeFileSync(join(dir, "http-9505.json"), '{"x":1}');
    chmodSync(join(dir, "http-9505.json"), 0o666);
    expect(readCapabilities(9505, dir)).toBeNull();
  });
});
