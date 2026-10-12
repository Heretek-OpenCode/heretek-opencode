import { describe, expect, test } from "bun:test";
import { runProductionPipeline } from "../src/verify/production";

const TAP_PASS = `TAP version 13
ok 1 test_player_moves
ok 2 test_hud_updates
1..2
`;

describe("e2e production benchmark (mocked, no engine)", () => {
  test("full pipeline green with mocks, engine-unavailable tolerant", async () => {
    const result = await runProductionPipeline({
      brief: "Top-down survivor: player CharacterBody2D + HUD health label",
      gutTAP: TAP_PASS,
      // No binary: headless degrades to unavailable, viewport to stale.
      headlessAvailable: false,
      viewportStale: true,
    });
    expect(result.stages.devStory).toBe("pass");
    expect(result.stages.scene).toBe("pass");
    expect(result.stages.script).toBe("pass");
    expect(result.stages.signal).toBe("pass");
    expect(result.stages.hudStyle).toBe("pass");
    expect(result.stages.gut).toBe("pass");
    // Degraded but tolerated — never fail the pipeline without an engine.
    expect(result.stages.headless).toBe("unavailable-tolerated");
    expect(result.stages.viewport).toBe("stale-tolerated");
    expect(result.ok).toBe(true);
    expect(result.architectureMap).toContain("# Architecture Map");
  });

  test("gut failure fails the pipeline", async () => {
    const result = await runProductionPipeline({
      brief: "concept",
      gutTAP: "not ok 1 test_broken\n",
      headlessAvailable: true,
      viewportStale: false,
    });
    expect(result.ok).toBe(false);
    expect(result.stages.gut).toBe("fail");
  });

  test("headless errors fail when engine present", async () => {
    const result = await runProductionPipeline({
      brief: "concept",
      gutTAP: TAP_PASS,
      headlessAvailable: true,
      headlessErrorOutput:
        "SCRIPT ERROR: Parse Error\nat: GDScript::reload (res://scripts/player.gd:3:1)",
      viewportStale: false,
    });
    expect(result.stages.headless).toBe("fail");
    expect(result.ok).toBe(false);
  });
});
