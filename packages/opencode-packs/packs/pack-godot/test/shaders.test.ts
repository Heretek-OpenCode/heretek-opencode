import { describe, expect, test } from "bun:test";
import {
  applyStyleOverride,
  buildStyleBoxFlat,
  generateShader,
  injectUniform,
  listUniforms,
} from "../src/studio/shaders";

describe("shader generation", () => {
  test("spatial template has shader_type + uniforms", () => {
    const src = generateShader("spatial", {
      uniforms: [{ name: "albedo_color", type: "vec4" }],
    });
    expect(src).toContain("shader_type spatial");
    expect(src).toContain("uniform vec4 albedo_color");
  });

  test("canvas_item template", () => {
    const src = generateShader("canvas_item");
    expect(src).toContain("shader_type canvas_item");
  });
});

describe("uniform injection", () => {
  test("injects uniform after shader_type line", () => {
    const base =
      "shader_type spatial;\nvoid fragment() { ALBEDO = vec3(1.0); }";
    const out = injectUniform(base, { name: "pulse_speed", type: "float" });
    expect(out).toContain("uniform float pulse_speed");
    const lines = out.split("\n");
    expect(lines[0]).toContain("shader_type");
    expect(lines[1]).toContain("uniform float pulse_speed");
  });

  test("inject with hint and default", () => {
    const base = "shader_type canvas_item;";
    const out = injectUniform(base, {
      name: "tint",
      type: "vec4",
      hint: "source_color",
      defaultValue: "vec4(1.0)",
    });
    expect(out).toContain("uniform vec4 tint");
    expect(out).toContain("source_color");
    expect(out).toContain("vec4(1.0)");
  });

  test("duplicate uniform is replaced, not doubled", () => {
    const base = "shader_type spatial;\nuniform float speed = 1.0;";
    const out = injectUniform(base, {
      name: "speed",
      type: "float",
      defaultValue: "2.0",
    });
    const count = out
      .split("\n")
      .filter((l) => l.includes("uniform float speed")).length;
    expect(count).toBe(1);
    expect(out).toContain("2.0");
  });

  test("listUniforms round-trips injected uniforms", () => {
    const base = generateShader("spatial", {
      uniforms: [
        { name: "a", type: "float" },
        { name: "b", type: "vec4" },
      ],
    });
    const names = listUniforms(base).map((u) => u.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
  });
});

describe("theme style overrides", () => {
  test("buildStyleBoxFlat defaults", () => {
    const sb = buildStyleBoxFlat({ bgColor: "#1a1d29" });
    expect(sb.bg_color).toBe("#1a1d29");
    expect(typeof sb.corner_radius).toBe("number");
  });

  test("style override round-trip merges", () => {
    const base = buildStyleBoxFlat({ bgColor: "#111111", cornerRadius: 4 });
    const merged = applyStyleOverride(base, { cornerRadius: 12 });
    expect(merged.bg_color).toBe("#111111");
    expect(merged.corner_radius).toBe(12);
    // base untouched (immutable merge)
    expect(base.corner_radius).toBe(4);
  });
});
