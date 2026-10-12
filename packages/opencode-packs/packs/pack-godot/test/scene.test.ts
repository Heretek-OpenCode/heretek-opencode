import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseSceneConnections,
  parseSceneExtResources,
  validateSceneText,
} from "../src/verify/scene";

const VALID_SCENE = `[gd_scene load_steps=3 format=3 uid="uid://bvalid123"]
[ext_resource type="Script" path="res://scripts/player.gd" id="1"]
[node name="Player" type="Node2D"]
script = ExtResource("1")
`;

const BROKEN_SCENE = `[gd_scene load_steps=4 format=3 uid="uid://bbroken1"]
[ext_resource type="Script" path="res://scripts/missing.gd" id="1"]
[ext_resource type="Texture2D" path="res://art/gone.png" id="2"]
[node name="Root" type="Node"]
[connection signal="pressed" from="Button" to="." method="on_missing"]
`;

describe("scene validator", () => {
  test("valid scene passes", () => {
    const result = validateSceneText(VALID_SCENE, {
      fileExists: () => true,
    });
    expect(result.status).toBe("ok");
    expect(result.issues).toEqual([]);
  });

  test("broken dependency is reported", () => {
    const result = validateSceneText(BROKEN_SCENE, {
      fileExists: (p) => !p.includes("missing") && !p.includes("gone"),
    });
    expect(result.status).toBe("error");
    const kinds = result.issues.map((i) => i.kind);
    expect(kinds).toContain("missing-ext-resource");
    expect(kinds).toContain("broken-connection");
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  test("ext-resource parser extracts paths", () => {
    const ext = parseSceneExtResources(VALID_SCENE);
    expect(ext).toEqual([
      { type: "Script", path: "res://scripts/player.gd", id: "1" },
    ]);
  });

  test("connection parser extracts refs", () => {
    const conns = parseSceneConnections(BROKEN_SCENE);
    expect(conns.length).toBe(1);
    expect(conns[0]).toMatchObject({
      signal: "pressed",
      from: "Button",
      method: "on_missing",
    });
  });

  test("missing required sections are flagged", () => {
    const result = validateSceneText("garbage with no header", {
      fileExists: () => true,
    });
    expect(result.status).toBe("error");
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test("godot harness exists and emits JSON", () => {
    const p = join(
      import.meta.dir,
      "..",
      "companion",
      "validate_scene.gd",
    );
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, "utf8");
    expect(src).toContain("JSON.stringify");
    expect(src).toContain("PackedScene");
  });
});
