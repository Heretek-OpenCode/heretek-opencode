import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FixtureSchema, type GoldenFixture } from "./schemas.js";

export interface LoadedFixture extends GoldenFixture {
  /** Source file (for error messages). */
  file: string;
  /** sha256 over the canonical JSON of the fixture body (minus `file`). */
  sha256: string;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function fixtureHash(fixture: GoldenFixture): string {
  return createHash("sha256").update(canonicalJson(fixture), "utf8").digest("hex");
}

/** Loads + validates one fixture file. Throws on schema mismatch. */
export function loadFixture(path: string): LoadedFixture {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  const fixture = FixtureSchema.parse(parsed);
  return { ...fixture, file: path, sha256: fixtureHash(fixture) };
}

function collectJsonFiles(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collectJsonFiles(full, out);
    else if (name.endsWith(".json")) out.push(full);
  }
}

/** Loads + validates every *.json fixture under `dir` (recursive). */
export function loadAllFixtures(dir: string): LoadedFixture[] {
  const files: string[] = [];
  collectJsonFiles(dir, files);
  files.sort();
  return files.map(loadFixture);
}

/**
 * Hash check for vendored fixtures: recomputes each fixture's sha256 and
 * compares against a pinned manifest (`{ "<relpath>": "<sha256>" }`).
 * Returns mismatches (empty = all pinned bytes intact).
 */
export function checkFixtureHashes(
  dir: string,
  manifest: Record<string, string>,
): Array<{ file: string; expected: string; actual: string }> {
  const mismatches: Array<{ file: string; expected: string; actual: string }> = [];
  for (const fixture of loadAllFixtures(dir)) {
    const rel = fixture.file.startsWith(dir) ? fixture.file.slice(dir.length).replace(/^[/\\]/, "") : fixture.file;
    const expected = manifest[rel];
    if (expected === undefined) {
      mismatches.push({ file: rel, expected: "(pinned)", actual: fixture.sha256 });
    } else if (expected !== fixture.sha256) {
      mismatches.push({ file: rel, expected, actual: fixture.sha256 });
    }
  }
  return mismatches;
}

/** Builds a pin manifest for the current fixture bytes (vendor-by-commit). */
export function buildFixtureManifest(dir: string): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const fixture of loadAllFixtures(dir)) {
    const rel = fixture.file.startsWith(dir) ? fixture.file.slice(dir.length).replace(/^[/\\]/, "") : fixture.file;
    manifest[rel] = fixture.sha256;
  }
  return manifest;
}
