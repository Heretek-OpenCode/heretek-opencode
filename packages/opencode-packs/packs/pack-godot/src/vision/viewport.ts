// Viewport vision & screenshots (no Godot binary required).
// Pure framing math + stale-fallback detection. Runtime capture goes
// through the debugger bridge (companion viewport_handler.gd); when the
// main loop stalls, frames older than MAIN_LOOP_STALL_MSEC degrade to a
// `stale` result instead of blocking the pipeline.

export const MAIN_LOOP_STALL_MSEC = 1000;

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface AABB {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface FramingResult {
  readonly center: Vec3;
  readonly size: Vec3;
  readonly radius: number;
  readonly distance: number;
  readonly cameraPos: Vec3;
}

export type ViewportMode = "2d" | "3d";

export interface CaptureParams {
  readonly mode: ViewportMode;
  readonly width: number;
  readonly height: number;
  readonly framing?: FramingResult;
  readonly aabb?: AABB;
}

export interface CaptureParamsInput {
  readonly mode: ViewportMode;
  readonly width?: number;
  readonly height?: number;
  readonly aabb?: AABB;
  readonly fovDeg?: number;
  readonly padding?: number;
}

export type CaptureStatus = "ok" | "stale" | "unavailable";

export interface RawCapture {
  readonly pngBase64?: string;
  readonly width?: number;
  readonly height?: number;
  readonly capturedAtMs?: number;
}

export interface CaptureResult {
  readonly status: CaptureStatus;
  readonly pngBase64: string;
  readonly width: number;
  readonly height: number;
  readonly stale: boolean;
  readonly capturedAtMs: number;
  readonly reason?: string;
}

/** Half-diagonal framing: distance so the bounding sphere fits the FOV. */
export function frameAABB(
  aabb: AABB,
  fovDeg = 70,
  padding = 1.2,
): FramingResult {
  const center: Vec3 = {
    x: (aabb.min.x + aabb.max.x) / 2,
    y: (aabb.min.y + aabb.max.y) / 2,
    z: (aabb.min.z + aabb.max.z) / 2,
  };
  const size: Vec3 = {
    x: Math.abs(aabb.max.x - aabb.min.x),
    y: Math.abs(aabb.max.y - aabb.min.y),
    z: Math.abs(aabb.max.z - aabb.min.z),
  };
  const radius =
    Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) / 2;
  const halfFovRad = ((fovDeg > 0 ? fovDeg : 70) * Math.PI) / 360;
  const tan = Math.tan(halfFovRad);
  const safeTan = tan > 1e-6 ? tan : 1e-6;
  const distance = (radius * (padding > 0 ? padding : 1.0)) / safeTan;
  return {
    center,
    size,
    radius,
    distance,
    cameraPos: { x: center.x, y: center.y, z: center.z + distance },
  };
}

export function isStaleFrame(
  capturedAtMs: number,
  nowMs: number,
  stallMs: number = MAIN_LOOP_STALL_MSEC,
): boolean {
  return nowMs - capturedAtMs >= stallMs;
}

export function buildCaptureParams(input: CaptureParamsInput): CaptureParams {
  const width = input.width ?? 1280;
  const height = input.height ?? 720;
  if (input.mode === "3d" && input.aabb) {
    return {
      mode: "3d",
      width,
      height,
      aabb: input.aabb,
      framing: frameAABB(input.aabb, input.fovDeg ?? 70, input.padding ?? 1.2),
    };
  }
  return { mode: input.mode, width, height };
}

export function parseCaptureResult(
  raw: RawCapture,
  nowMs: number,
): CaptureResult {
  const capturedAtMs = raw.capturedAtMs ?? nowMs;
  if (!raw.pngBase64 || raw.pngBase64.length === 0) {
    return {
      status: "unavailable",
      pngBase64: "",
      width: raw.width ?? 0,
      height: raw.height ?? 0,
      stale: true,
      capturedAtMs,
      reason: "viewport capture unavailable (no frame from debugger bridge)",
    };
  }
  const stale = isStaleFrame(capturedAtMs, nowMs);
  return {
    status: stale ? "stale" : "ok",
    pngBase64: raw.pngBase64,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    stale,
    capturedAtMs,
    ...(stale
      ? { reason: `stale frame: age exceeded ${MAIN_LOOP_STALL_MSEC}ms` }
      : {}),
  };
}

export interface ViewportToolParams {
  readonly mode?: string;
  readonly width?: number;
  readonly height?: number;
}

/** Bridge adapter for the `godot_capture_viewport` tool. */
export async function executeCaptureViewport(
  params: ViewportToolParams,
  send: (method: string, p: unknown) => Promise<unknown>,
  nowMs: number = Date.now(),
): Promise<CaptureResult> {
  const mode: ViewportMode = params.mode === "3d" ? "3d" : "2d";
  const built = buildCaptureParams({
    mode,
    width: params.width,
    height: params.height,
  });
  let raw: RawCapture;
  try {
    const res = (await send("capture_viewport", {
      mode: built.mode,
      width: built.width,
      height: built.height,
    })) as Record<string, unknown>;
    raw = {
      ...(typeof res.pngBase64 === "string"
        ? { pngBase64: res.pngBase64 }
        : {}),
      ...(typeof res.width === "number" ? { width: res.width } : {}),
      ...(typeof res.height === "number" ? { height: res.height } : {}),
      ...(typeof res.capturedAtMs === "number"
        ? { capturedAtMs: res.capturedAtMs }
        : {}),
    };
  } catch (err) {
    return {
      status: "unavailable",
      pngBase64: "",
      width: 0,
      height: 0,
      stale: true,
      capturedAtMs: nowMs,
      reason: err instanceof Error ? err.message : "capture bridge failed",
    };
  }
  return parseCaptureResult(raw, nowMs);
}
