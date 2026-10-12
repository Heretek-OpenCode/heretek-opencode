import { describe, expect, test } from "bun:test";
import {
  MAIN_LOOP_STALL_MSEC,
  buildCaptureParams,
  frameAABB,
  isStaleFrame,
  parseCaptureResult,
} from "../src/vision/viewport";

describe("viewport framing math", () => {
  test("frames unit cube centered at origin", () => {
    const r = frameAABB(
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      90,
      1.0,
    );
    expect(r.center.x).toBeCloseTo(0, 9);
    expect(r.center.y).toBeCloseTo(0, 9);
    expect(r.center.z).toBeCloseTo(0, 9);
    // half-extent 1, fov 90 -> tan(45)=1 -> distance ~= radius(√3≈1.732)
    expect(r.distance).toBeGreaterThan(1.7);
    expect(r.distance).toBeLessThan(1.8);
    // camera looks down -z from +z
    expect(r.cameraPos.z).toBeCloseTo(r.center.z + r.distance, 9);
  });

  test("offset box shifts center", () => {
    const r = frameAABB(
      { min: { x: 10, y: 0, z: 0 }, max: { x: 12, y: 2, z: 2 } },
      70,
      1.0,
    );
    expect(r.center.x).toBeCloseTo(11, 9);
    expect(r.center.y).toBeCloseTo(1, 9);
    expect(r.center.z).toBeCloseTo(1, 9);
  });

  test("padding scales distance linearly", () => {
    const aabb = {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 2, y: 2, z: 2 },
    };
    const a = frameAABB(aabb, 60, 1.0);
    const b = frameAABB(aabb, 60, 2.0);
    expect(b.distance).toBeCloseTo(a.distance * 2, 9);
  });
});

describe("stale frame detection", () => {
  test("stall threshold constant is 1000ms", () => {
    expect(MAIN_LOOP_STALL_MSEC).toBe(1000);
  });

  test("fresh frame is not stale", () => {
    expect(isStaleFrame(9000, 9500)).toBe(false);
  });

  test("frame older than stall window is stale", () => {
    expect(isStaleFrame(8000, 9500)).toBe(true);
  });

  test("boundary is stale (>=)", () => {
    expect(isStaleFrame(8500, 9500)).toBe(true);
  });
});

describe("capture result parsing", () => {
  test("fresh base64 PNG parses ok, not stale", () => {
    const r = parseCaptureResult(
      { pngBase64: "aGVsbG8=", width: 1280, height: 720, capturedAtMs: 9500 },
      9600,
    );
    expect(r.stale).toBe(false);
    expect(r.pngBase64).toBe("aGVsbG8=");
    expect(r.status).toBe("ok");
  });

  test("stale fallback: old timestamp marks stale", () => {
    const r = parseCaptureResult(
      { pngBase64: "aGVsbG8=", width: 640, height: 480, capturedAtMs: 1000 },
      9500,
    );
    expect(r.stale).toBe(true);
    expect(r.status).toBe("stale");
  });

  test("missing png degrades to unavailable, not throw", () => {
    const r = parseCaptureResult({ capturedAtMs: 9500 }, 9600);
    expect(r.status).toBe("unavailable");
    expect(r.pngBase64).toBe("");
  });
});

describe("capture params builder", () => {
  test("2d defaults", () => {
    const p = buildCaptureParams({ mode: "2d" });
    expect(p.mode).toBe("2d");
    expect(p.width).toBeGreaterThan(0);
  });

  test("3d with aabb includes framing", () => {
    const p = buildCaptureParams({
      mode: "3d",
      aabb: {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 1, y: 1, z: 1 },
      },
    });
    expect(p.mode).toBe("3d");
    expect(p.framing).toBeDefined();
    expect(p.framing?.center.x).toBeCloseTo(0.5, 9);
  });
});
