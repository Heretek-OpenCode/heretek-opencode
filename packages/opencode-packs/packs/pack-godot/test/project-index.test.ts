import { describe, expect, test } from "bun:test";
import {
  indexProject,
  parseProjectGodot,
  parseTscn,
  renderArchitectureMap,
} from "../src/indexer/project";

const PLAYER_TSCN = `[gd_scene load_steps=3 format=3 uid="uid://bplayer"]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]
[ext_resource type="PackedScene" path="res://scenes/hud.tscn" id="2"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")

[node name="Sprite" type="Sprite2D" parent="."]
texture_filter = 1

[node name="HUD" parent="." instance=ExtResource("2")]

[connection signal="health_changed" from="." to="HUD" method="_on_health_changed"]
[connection signal="died" from="." to="." method="_on_died"]
`;

const HUD_TSCN = `[gd_scene load_steps=2 format=3 uid="uid://bhud"]

[ext_resource type="Script" path="res://scripts/hud.gd" id="1"]

[node name="HUD" type="CanvasLayer"]
script = ExtResource("1")

[node name="Label" type="Label" parent="."]
`;

const PROJECT_GODOT = `; Engine configuration file.
config_version=5

[application]
config/name="Fixture Game"

[autoload]
GameState="*res://scripts/game_state.gd"
Audio="*res://scripts/audio.gd"

[rendering]
renderer/rendering_method="gl_compatibility"
`;

const HUD_GD = `extends CanvasLayer

func _on_health_changed(value: int) -> void:
\tpass
`;

describe("tscn parser (VariantParser-grammar subset)", () => {
  test("parses nodes, ext_resources, connections", () => {
    const parsed = parseTscn(PLAYER_TSCN);
    expect(parsed.nodes.map((n) => n.name)).toEqual([
      "Player",
      "Sprite",
      "HUD",
    ]);
    expect(parsed.extResources.map((e) => e.path)).toContain(
      "res://scripts/player.gd",
    );
    expect(parsed.connections).toHaveLength(2);
    expect(parsed.connections[0]?.signal).toBe("health_changed");
  });

  test("malformed scene without header throws structured error", () => {
    expect(() => parseTscn("garbage")).toThrow(/gd_scene/);
  });
});

describe("project.godot autoload parsing", () => {
  test("extracts autoload singletons", () => {
    const loads = parseProjectGodot(PROJECT_GODOT);
    expect(loads.map((a) => a.name)).toEqual(["GameState", "Audio"]);
    expect(loads[0]?.path).toBe("res://scripts/game_state.gd");
  });
});

describe("indexProject fixture", () => {
  const files: Record<string, string> = {
    "project.godot": PROJECT_GODOT,
    "scenes/player.tscn": PLAYER_TSCN,
    "scenes/hud.tscn": HUD_TSCN,
    "scripts/hud.gd": HUD_GD,
  };
  const fs = {
    listFiles: () => Object.keys(files),
    readFile: (p: string) => {
      const v = files[p];
      if (v === undefined) throw new Error(`missing file: ${p}`);
      return v;
    },
  };

  test("indexes scenes, autoloads, signal graph, script table", async () => {
    const idx = await indexProject(fs);
    expect(idx.scenes.map((s) => s.path).sort()).toEqual([
      "scenes/hud.tscn",
      "scenes/player.tscn",
    ]);
    expect(idx.autoloads.map((a) => a.name).sort()).toEqual([
      "Audio",
      "GameState",
    ]);
    expect(idx.signalGraph.length).toBeGreaterThanOrEqual(2);
    expect(idx.scripts.map((s) => s.path)).toContain("res://scripts/player.gd");
  });

  test("renders Markdown architecture map", async () => {
    const idx = await indexProject(fs);
    const md = renderArchitectureMap(idx);
    expect(md).toContain("# Architecture Map");
    expect(md).toContain("## Autoloads");
    expect(md).toContain("## Scenes");
    expect(md).toContain("## Signal Graph");
    expect(md).toContain("## Scripts");
    expect(md).toContain("Player");
    expect(md).toContain("health_changed");
  });
});
