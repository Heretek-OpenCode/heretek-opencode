// Headless CLI syntax & type checker (zero-Python).
// Shells out to `godot --headless --check-only -s <script>` when a binary
// exists; degrades to a structured `unavailable` result when it does not.
// Tests run without a Godot binary via injected runFn mocks.

export interface GodotDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly message: string;
}

export type HeadlessStatus = "ok" | "error" | "unavailable" | "timeout";

export interface HeadlessResult {
  readonly status: HeadlessStatus;
  readonly diagnostics: readonly GodotDiagnostic[];
  readonly raw: string;
  readonly exitCode?: number;
  readonly reason?: string;
}

export interface HeadlessRunOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type HeadlessRunFn = (
  args: readonly string[],
) => Promise<HeadlessRunOutput>;

export interface HeadlessRunnerOptions {
  readonly godotBinary?: string;
  readonly timeoutMs?: number;
  readonly runFn?: HeadlessRunFn;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function messageLines(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function nearestMessage(lines: string[], atIndex: number): string {
  // Prefer the closest SCRIPT ERROR / ERROR / Parse Error line.
  for (let i = atIndex; i >= 0 && i >= atIndex - 4; i--) {
    const line = lines[i] ?? "";
    if (/SCRIPT ERROR|ERROR|Parse Error|Parser Error/i.test(line)) return line;
  }
  for (let i = atIndex + 1; i < lines.length && i <= atIndex + 2; i++) {
    const line = lines[i] ?? "";
    if (line) return line;
  }
  return lines[atIndex] ?? "godot reported an error";
}

// Godot 4 emits locations like:
//   at: GDScript::reload (res://scripts/player.gd:12:8)
// and one-line forms like res://scripts/player.gd:12:8 or file.gd:12.
const AT_LOCATION_RE = /at:\s*\S+\s*\(([^:()]+):(\d+)(?::(\d+))?\)/g;
const FILE_LOCATION_RE =
  /((?:res:\/\/|[A-Za-z0-9_./\\-]+\.gd)[^:()\s"']*):(\d+)(?::(\d+))?/g;

interface RawHit {
  file: string;
  line: number;
  col: number;
  index: number;
}

function collectHits(output: string): RawHit[] {
  const hits: RawHit[] = [];
  const seen = new Set<string>();
  for (const re of [AT_LOCATION_RE, FILE_LOCATION_RE]) {
    re.lastIndex = 0;
    while (true) {
      const m: RegExpExecArray | null = re.exec(output);
      if (m === null) break;
      const file = m[1] ?? "";
      const line = Number.parseInt(m[2] ?? "0", 10);
      const col = m[3] !== undefined ? Number.parseInt(m[3], 10) : 0;
      if (!file || !Number.isFinite(line) || line <= 0) continue;
      const key = `${file}:${line}:${Number.isFinite(col) ? col : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        file,
        line,
        col: Number.isFinite(col) ? col : 0,
        index: m.index,
      });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

export function parseHeadlessOutput(
  output: string,
  fallbackFile?: string,
): GodotDiagnostic[] {
  if (!output || output.trim().length === 0) return [];
  const lines = messageLines(output);
  const hits = collectHits(output);
  if (hits.length === 0) {
    // Non-location error text still yields one diagnostic when it looks
    // like an error, anchored to the fallback file when provided.
    const errLine = lines.find((l) =>
      /SCRIPT ERROR|ERROR|Parse Error|Parser Error|Failed/i.test(l),
    );
    if (!errLine) return [];
    return [
      {
        file: fallbackFile ?? "<unknown>",
        line: 1,
        col: 0,
        message: errLine,
      },
    ];
  }
  // Map each hit to the nearest message line by character offset.
  const lineOffsets: number[] = [];
  let acc = 0;
  for (const raw of output.split(/\r?\n/)) {
    lineOffsets.push(acc);
    acc += raw.length + 1;
  }
  return hits.map((hit) => {
    let lineIdx = 0;
    for (let i = 0; i < lineOffsets.length; i++) {
      if ((lineOffsets[i] ?? 0) <= hit.index) lineIdx = i;
      else break;
    }
    return {
      file: hit.file,
      line: hit.line,
      col: hit.col,
      message: nearestMessage(lines, lineIdx),
    };
  });
}

export function isBinaryMissingError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  const code = typeof rec.code === "string" ? rec.code : "";
  const message =
    err instanceof Error
      ? err.message
      : typeof rec.message === "string"
        ? rec.message
        : "";
  if (code === "ENOENT") return true;
  return /ENOENT|No such file|not found|cannot find|godot.*missing/i.test(
    message,
  );
}

async function defaultRun(
  binary: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<HeadlessRunOutput> {
  const proc = Bun.spawn([binary, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutReader = new Response(proc.stdout).text();
  const stderrReader = new Response(proc.stderr).text();
  const exitPromise = (async () => {
    const code = await proc.exited;
    const [stdout, stderr] = await Promise.all([stdoutReader, stderrReader]);
    return { exitCode: code, stdout, stderr };
  })();
  if (timeoutMs <= 0) return exitPromise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exitPromise,
      new Promise<HeadlessRunOutput>((_, reject) => {
        timer = setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // ignore kill noise
          }
          const err = new Error(`godot timed out after ${timeoutMs}ms`);
          (err as Error & { code?: string }).code = "ETIMEOUT";
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  if (rec.code === "ETIMEOUT") return true;
  return (
    err instanceof Error && /timed out|timeout|ETIMEDOUT/i.test(err.message)
  );
}

export class HeadlessRunner {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly runFn?: HeadlessRunFn;

  constructor(options: HeadlessRunnerOptions = {}) {
    this.binary = options.godotBinary ?? process.env.GODOT_BINARY ?? "godot";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runFn = options.runFn;
  }

  checkArgs(scriptPath: string): readonly string[] {
    return ["--headless", "--check-only", "-s", scriptPath];
  }

  async checkScript(scriptPath: string): Promise<HeadlessResult> {
    const args = this.checkArgs(scriptPath);
    let output: HeadlessRunOutput;
    try {
      if (this.runFn) {
        if ((this.timeoutMs ?? 0) > 0) {
          output = await Promise.race([
            this.runFn(args),
            new Promise<HeadlessRunOutput>((_, reject) => {
              setTimeout(() => {
                const err = new Error(
                  `godot timed out after ${this.timeoutMs}ms`,
                );
                (err as Error & { code?: string }).code = "ETIMEOUT";
                reject(err);
              }, this.timeoutMs);
            }),
          ]);
        } else {
          output = await this.runFn(args);
        }
      } else {
        output = await defaultRun(this.binary, args, this.timeoutMs);
      }
    } catch (err) {
      if (isBinaryMissingError(err)) {
        return {
          status: "unavailable",
          diagnostics: [],
          raw: "",
          reason: "godot binary not found on PATH",
        };
      }
      if (isTimeoutError(err)) {
        return {
          status: "timeout",
          diagnostics: [],
          raw: "",
          reason: err instanceof Error ? err.message : "godot run timed out",
        };
      }
      throw err;
    }
    const raw = [output.stdout, output.stderr]
      .filter((s) => s && s.length > 0)
      .join("\n");
    const diagnostics = parseHeadlessOutput(raw, scriptPath);
    if (output.exitCode === 0 && diagnostics.length === 0) {
      return { status: "ok", diagnostics: [], raw, exitCode: 0 };
    }
    if (diagnostics.length > 0 || output.exitCode !== 0) {
      return {
        status: "error",
        diagnostics,
        raw,
        exitCode: output.exitCode,
      };
    }
    return { status: "ok", diagnostics: [], raw, exitCode: output.exitCode };
  }
}
