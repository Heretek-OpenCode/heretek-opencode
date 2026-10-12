import { describe, expect, test } from "bun:test";
import {
  GODOT_CONTEXT_MARKER,
  applyContextInjection,
  buildContextInjection,
  collectGodotContext,
  studioContextHook,
} from "../src/studio/context";

describe("studio context packing", () => {
  test("injection contains engine version, editor status, scene tree", () => {
    const text = buildContextInjection({
      engineVersion: "4.3.stable",
      editorStatus: "connected",
      sceneTree: "Main(Node2D)\n  Player(CharacterBody2D)",
    });
    expect(text).toContain("4.3.stable");
    expect(text).toContain("connected");
    expect(text).toContain("Player");
    expect(text).toContain(GODOT_CONTEXT_MARKER);
  });

  test("hook injects into model context", async () => {
    const target = { agent: "godot-architect", system: [] as unknown[] };
    await studioContextHook(target as never, {
      getEngineVersion: async () => "4.3.stable",
      getEditorStatus: async () => "connected",
      getSceneTree: async () => "Main",
    });
    expect(target.system.length).toBe(1);
    const text = JSON.stringify(target.system[0]);
    expect(text).toContain("4.3.stable");
    expect(text).toContain("connected");
    expect(text).toContain("Main");
  });

  test("no duplication on repeat hooks (idempotent replace)", async () => {
    const target = { agent: "a", system: [] as unknown[] };
    const providers = {
      getEngineVersion: async () => "4.3",
      getEditorStatus: async () => "connected",
      getSceneTree: async () => "Main",
    };
    await studioContextHook(target as never, providers);
    await studioContextHook(target as never, providers);
    await studioContextHook(target as never, {
      getEngineVersion: async () => "4.4",
      getEditorStatus: async () => "connected",
      getSceneTree: async () => "Main2",
    });
    expect(target.system.length).toBe(1);
    expect(JSON.stringify(target.system[0])).toContain("4.4");
  });

  test("collectGodotContext falls back when providers missing", async () => {
    const snap = await collectGodotContext({});
    expect(snap.engineVersion.length).toBeGreaterThan(0);
    expect(snap.editorStatus.length).toBeGreaterThan(0);
    expect(typeof snap.sceneTree).toBe("string");
  });

  test("applyContextInjection preserves pre-existing entries", async () => {
    const target = { system: ["existing-prompt"] as unknown[] };
    applyContextInjection(target as never, {
      engineVersion: "4.3",
      editorStatus: "offline",
      sceneTree: "Empty",
    });
    expect(target.system.length).toBe(2);
    expect(target.system[0]).toBe("existing-prompt");
  });
});
