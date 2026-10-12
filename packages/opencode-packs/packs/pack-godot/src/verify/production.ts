// E2E production benchmark orchestrator (no engine required).
// Chains the /dev-story pipeline (mocked) with scene validation,
// typed GDScript checks, signal wiring, HUD styling, GUT + headless
// verification, viewport capture, and the architecture map. Engine-
// absent legs degrade to tolerated statuses instead of failing.

import { indexProject, renderArchitectureMap } from "../indexer/project";
import { runDevStory } from "../studio/commands";
import {
  applyStyleOverride,
  buildStyleBoxFlat,
  generateShader,
  injectUniform,
} from "../studio/shaders";
import { parseCaptureResult } from "../vision/viewport";
import { GutRunner } from "./gut";
import { HeadlessRunner } from "./headless";
import { validateSceneText } from "./scene";

export type ProductionStageStatus =
  | "pass"
  | "fail"
  | "unavailable-tolerated"
  | "stale-tolerated";

export interface ProductionPipelineInput {
  readonly brief: string;
  readonly gutTAP: string;
  readonly headlessAvailable: boolean;
  readonly viewportStale: boolean;
  readonly headlessErrorOutput?: string;
}

export interface ProductionPipelineResult {
  readonly ok: boolean;
  readonly stages: Record<string, ProductionStageStatus>;
  readonly architectureMap: string;
  readonly details: Record<string, unknown>;
}

const PLAYER_TSCN = `[gd_scene load_steps=3 format=3 uid="uid://bplayer"]

[ext_resource type="Script" path="res://scripts/player.gd" id="1"]
[ext_resource type="PackedScene" path="res://scenes/hud.tscn" id="2"]

[node name="Player" type="CharacterBody2D"]
script = ExtResource("1")

[node name="Sprite" type="Sprite2D" parent="."]

[node name="HUD" parent="." instance=ExtResource("2")]

[connection signal="health_changed" from="." to="HUD" method="_on_health_changed"]
`;

const PLAYER_GD = `extends CharacterBody2D
## Survivor player: typed movement + health signal.

signal health_changed(value: int)

@export var speed: float = 220.0
var health: int = 100

func _physics_process(delta: float) -> void:
\tvar dir := Input.get_vector("left", "right", "up", "down")
\tvelocity = dir * speed
\tmove_and_slide()

func take_damage(amount: int) -> void:
\thealth = maxi(health - amount, 0)
\thealth_changed.emit(health)
`;

function checkTypedScript(src: string): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!/^extends\s+CharacterBody2D/m.test(src))
    notes.push("missing extends CharacterBody2D");
  if (!/signal\s+health_changed/.test(src))
    notes.push("missing health_changed signal");
  if (!/@export\s+var\s+speed:\s*float/.test(src))
    notes.push("missing typed @export speed");
  if (!/func\s+take_damage\(amount:\s*int\)\s*->\s*void/.test(src))
    notes.push("missing typed take_damage");
  return { ok: notes.length === 0, notes };
}

export async function runProductionPipeline(
  input: ProductionPipelineInput,
): Promise<ProductionPipelineResult> {
  const stages: Record<string, ProductionStageStatus> = {};
  const details: Record<string, unknown> = {};

  // 1. Concept brief → /dev-story pipeline (mocked deps, always green).
  const story = await runDevStory(
    { storyId: "S-prod", prompt: input.brief },
    {
      loadStory: async (id: string) => ({ id, brief: input.brief }),
      spawnSpecialist: async (s: unknown) => s,
      runGut: async () => ({ passed: true }),
      runHeadlessCheck: async () => ({ passed: true }),
      commit: async () => ({ sha: "mock-prod" }),
    },
  );
  stages.devStory = story.ok ? "pass" : "fail";
  details.devStory = story.summary;

  // 2. Character scene validates clean.
  const sceneRes = validateSceneText(PLAYER_TSCN, {
    knownMethods: ["_on_health_changed"],
  });
  stages.scene = sceneRes.status === "ok" ? "pass" : "fail";
  details.scene = sceneRes.issues;

  // 3. Typed GDScript static checks.
  const scriptCheck = checkTypedScript(PLAYER_GD);
  stages.script = scriptCheck.ok ? "pass" : "fail";
  details.script = scriptCheck.notes;

  // 4. Signal wiring present (health_changed → HUD).
  const hasSignal = sceneRes.connections.some(
    (c) => c.signal === "health_changed" && c.method === "_on_health_changed",
  );
  stages.signal = hasSignal ? "pass" : "fail";

  // 5. HUD style: shader uniform injection + StyleBox round-trip.
  let hudOk = false;
  try {
    const base = generateShader("canvas_item");
    const injected = injectUniform(base, { name: "tint", type: "vec4" });
    const styled = applyStyleOverride(buildStyleBoxFlat({}), {
      cornerRadius: 12,
    });
    hudOk =
      injected.includes("uniform vec4 tint") && styled.corner_radius === 12;
  } catch {
    hudOk = false;
  }
  stages.hudStyle = hudOk ? "pass" : "fail";

  // 6. GUT suite (mocked TAP).
  const gut = new GutRunner({
    runFn: async () => ({ exitCode: 0, stdout: input.gutTAP, stderr: "" }),
  });
  const gutRes = await gut.run();
  stages.gut = gutRes.status === "pass" ? "pass" : "fail";
  details.gut = {
    total: gutRes.total,
    pass: gutRes.pass,
    fail: gutRes.fail,
  };

  // 7. Headless verify: unavailable-tolerant without engine.
  if (!input.headlessAvailable) {
    const runner = new HeadlessRunner({
      runFn: async () => {
        const err = new Error("spawn godot ENOENT") as Error & {
          code?: string;
        };
        err.code = "ENOENT";
        throw err;
      },
    });
    const res = await runner.checkScript("res://scripts/player.gd");
    stages.headless =
      res.status === "unavailable" ? "unavailable-tolerated" : "fail";
    details.headless = res.status;
  } else {
    const out = input.headlessErrorOutput ?? "";
    const runner = new HeadlessRunner({
      runFn: async () => ({
        exitCode: out ? 1 : 0,
        stdout: out,
        stderr: "",
      }),
    });
    const res = await runner.checkScript("res://scripts/player.gd");
    stages.headless = res.status === "ok" ? "pass" : "fail";
    details.headless = res.status;
  }

  // 8. Viewport capture: stale-tolerant without a live main loop.
  const now = 100_000;
  const capture = parseCaptureResult(
    {
      pngBase64: "aGVsbG8=",
      width: 1280,
      height: 720,
      capturedAtMs: input.viewportStale ? now - 5000 : now - 100,
    },
    now,
  );
  stages.viewport =
    capture.status === "ok"
      ? "pass"
      : capture.status === "stale"
        ? "stale-tolerated"
        : "fail";
  details.viewport = capture.status;

  // 9. Architecture map over the benchmark fixture.
  const idx = await indexProject({
    listFiles: () => ["scenes/player.tscn", "scenes/hud.tscn"],
    readFile: (p: string) =>
      p === "scenes/player.tscn"
        ? PLAYER_TSCN
        : `[gd_scene load_steps=1 format=3]\n\n[node name="HUD" type="CanvasLayer"]\n`,
  });
  const architectureMap = renderArchitectureMap(idx);
  details.architectureMapBytes = architectureMap.length;

  const ok = Object.values(stages).every(
    (s) =>
      s === "pass" || s === "unavailable-tolerated" || s === "stale-tolerated",
  );
  return { ok, stages, architectureMap, details };
}
