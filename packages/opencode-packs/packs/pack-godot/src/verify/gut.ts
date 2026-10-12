// GUT test runner (zero-Python).
// Runs `godot --headless -s res://addons/gut/gut_cmdln.gd -gdir=res://tests/
// -gexit` when a binary exists; parses TAP/JUnit into structured results.
// Degrades to `unavailable` when no binary is present so tests pass on CI
// images without Godot.

export interface GutTestCase {
  readonly name: string;
  readonly status: "pass" | "fail" | "skip";
  readonly file?: string;
  readonly line?: number;
  readonly message?: string;
  readonly stack?: readonly string[];
  readonly durationMs?: number;
}

export interface GutParseResult {
  readonly total: number;
  readonly pass: number;
  readonly fail: number;
  readonly skipped: number;
  readonly tests: readonly GutTestCase[];
  readonly durationMs?: number;
}

export type GutStatus = "pass" | "fail" | "error" | "unavailable" | "timeout";

export interface GutRunResult extends GutParseResult {
  readonly status: GutStatus;
  readonly raw: string;
  readonly exitCode?: number;
  readonly reason?: string;
}

export interface GutRunOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type GutRunFn = (args: readonly string[]) => Promise<GutRunOutput>;

export interface GutRunnerOptions {
  readonly godotBinary?: string;
  readonly testDir?: string;
  readonly timeoutMs?: number;
  readonly runFn?: GutRunFn;
}

const DEFAULT_TIMEOUT_MS = 300_000;

function parseDurationMs(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const m = /time=([\d.]+)s?/.exec(token);
  if (!m) return undefined;
  const secs = Number.parseFloat(m[1] ?? "NaN");
  if (!Number.isFinite(secs)) return undefined;
  return Math.round(secs * 1000);
}

function parseFileRef(text: string): {
  file?: string;
  line?: number;
  stack?: string[];
} {
  const m = /(res:\/\/[^\s:"']+|\S+\.gd):(\d+)/.exec(text);
  if (!m) {
    const trimmed = text.trim();
    return trimmed ? { stack: [trimmed] } : {};
  }
  const stack = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    file: m[1],
    line: Number.parseInt(m[2] ?? "0", 10),
    stack: stack.length > 0 ? stack : [text.trim()],
  };
}

export function parseGutTap(output: string): GutParseResult {
  const tests: GutTestCase[] = [];
  let skipped = 0;
  const lines = output.split(/\r?\n/);
  const tapRe = /^(ok|not ok)\s+(\d+)\s+([^\s#]+)(?:\s*#\s*(.*))?$/;
  for (const raw of lines) {
    const line = raw.trim();
    const m = tapRe.exec(line);
    if (!m) {
      if (/^ok.*#\s*SKIP/i.test(line)) skipped += 1;
      continue;
    }
    const ok = m[1] === "ok";
    const name = (m[3] ?? "").trim() || `test_${m[2]}`;
    const comment = (m[4] ?? "").trim();
    const isSkip = /^\s*SKIP/i.test(comment);
    if (isSkip) skipped += 1;
    const ref = comment ? parseFileRef(comment) : {};
    tests.push({
      name,
      status: isSkip ? "skip" : ok ? "pass" : "fail",
      ...(ref.file ? { file: ref.file } : {}),
      ...(ref.line ? { line: ref.line } : {}),
      ...(!ok && comment ? { message: comment } : {}),
      ...(ref.stack ? { stack: ref.stack } : {}),
      ...(parseDurationMs(comment) !== undefined
        ? { durationMs: parseDurationMs(comment) }
        : {}),
    });
  }
  const pass = tests.filter((t) => t.status === "pass").length;
  const fail = tests.filter((t) => t.status === "fail").length;
  return { total: tests.length, pass, fail, skipped, tests };
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:\\s|^)${name}="([^"]*)"`).exec(tag);
  return m?.[1];
}

export function parseGutJUnit(xml: string): GutParseResult {
  const tests: GutTestCase[] = [];
  const caseRe =
    /<testcase\b[^>]*?\/>|<testcase\b[^>]*?>([\s\S]*?)<\/testcase>/g;
  caseRe.lastIndex = 0;
  while (true) {
    const m: RegExpExecArray | null = caseRe.exec(xml);
    if (m === null) break;
    const full = m[0] ?? "";
    const openTag = /<testcase\b[^>]*>/.exec(full)?.[0] ?? full;
    const name = attr(openTag, "name") ?? "unknown";
    const timeAttr = attr(openTag, "time");
    const secs = timeAttr ? Number.parseFloat(timeAttr) : Number.NaN;
    const durationMs =
      Number.isFinite(secs) && timeAttr ? Math.round(secs * 1000) : undefined;
    const failureBody = /<failure\b[^>]*>([\s\S]*?)<\/failure>/.exec(full)?.[1];
    const skippedBody = /<skipped\b/.test(full);
    if (failureBody !== undefined) {
      const text = failureBody.trim();
      const ref = parseFileRef(text);
      tests.push({
        name,
        status: "fail",
        ...(ref.file ? { file: ref.file } : {}),
        ...(ref.line ? { line: ref.line } : {}),
        message: text.split(/\r?\n/)[0] ?? "test failed",
        stack: ref.stack ?? (text ? [text] : []),
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
    } else {
      tests.push({
        name,
        status: skippedBody ? "skip" : "pass",
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
    }
  }
  const pass = tests.filter((t) => t.status === "pass").length;
  const fail = tests.filter((t) => t.status === "fail").length;
  const skipped = tests.filter((t) => t.status === "skip").length;
  return { total: tests.length, pass, fail, skipped, tests };
}

export function detectGutFormat(output: string): "tap" | "junit" | "unknown" {
  if (/^TAP version|^(ok|not ok)\s+\d+/m.test(output)) return "tap";
  if (/<testsuites?[\s>]/.test(output)) return "junit";
  return "unknown";
}

export function parseGutOutput(output: string): GutParseResult {
  const format = detectGutFormat(output);
  if (format === "tap") return parseGutTap(output);
  if (format === "junit") return parseGutJUnit(output);
  return { total: 0, pass: 0, fail: 0, skipped: 0, tests: [] };
}

function isMissingBinary(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  if (rec.code === "ENOENT") return true;
  const msg =
    err instanceof Error
      ? err.message
      : typeof rec.message === "string"
        ? rec.message
        : "";
  return /ENOENT|No such file|not found|cannot find/i.test(msg);
}

function isTimeout(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as Record<string, unknown>;
  if (rec.code === "ETIMEOUT") return true;
  return (
    err instanceof Error && /timed out|timeout|ETIMEDOUT/i.test(err.message)
  );
}

async function defaultGutRun(
  binary: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<GutRunOutput> {
  const proc = Bun.spawn([binary, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = new Response(proc.stdout).text();
  const errText = new Response(proc.stderr).text();
  const exitP = (async () => {
    const code = await proc.exited;
    const [stdout, stderr] = await Promise.all([out, errText]);
    return { exitCode: code, stdout, stderr };
  })();
  if (timeoutMs <= 0) return exitP;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exitP,
      new Promise<GutRunOutput>((_, reject) => {
        timer = setTimeout(() => {
          try {
            proc.kill();
          } catch {
            // ignore
          }
          const e = new Error(`gut timed out after ${timeoutMs}ms`);
          (e as Error & { code?: string }).code = "ETIMEOUT";
          reject(e);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class GutRunner {
  private readonly binary: string;
  private readonly testDir: string;
  private readonly timeoutMs: number;
  private readonly runFn?: GutRunFn;

  constructor(options: GutRunnerOptions = {}) {
    this.binary = options.godotBinary ?? process.env.GODOT_BINARY ?? "godot";
    this.testDir = options.testDir ?? "res://tests/";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.runFn = options.runFn;
  }

  commandArgs(): readonly string[] {
    return [
      "--headless",
      "-s",
      "res://addons/gut/gut_cmdln.gd",
      `-gdir=${this.testDir}`,
      "-gexit",
    ];
  }

  async run(): Promise<GutRunResult> {
    const args = this.commandArgs();
    let output: GutRunOutput;
    try {
      if (this.runFn) {
        output =
          this.timeoutMs > 0
            ? await Promise.race([
                this.runFn(args),
                new Promise<GutRunOutput>((_, reject) => {
                  setTimeout(() => {
                    const e = new Error(
                      `gut timed out after ${this.timeoutMs}ms`,
                    );
                    (e as Error & { code?: string }).code = "ETIMEOUT";
                    reject(e);
                  }, this.timeoutMs);
                }),
              ])
            : await this.runFn(args);
      } else {
        output = await defaultGutRun(this.binary, args, this.timeoutMs);
      }
    } catch (err) {
      if (isMissingBinary(err)) {
        return {
          status: "unavailable",
          total: 0,
          pass: 0,
          fail: 0,
          skipped: 0,
          tests: [],
          raw: "",
          reason: "godot binary not found on PATH",
        };
      }
      if (isTimeout(err)) {
        return {
          status: "timeout",
          total: 0,
          pass: 0,
          fail: 0,
          skipped: 0,
          tests: [],
          raw: "",
          reason: err instanceof Error ? err.message : "gut run timed out",
        };
      }
      throw err;
    }
    const raw = [output.stdout, output.stderr]
      .filter((s) => s && s.length > 0)
      .join("\n");
    const parsed = parseGutOutput(raw);
    if (parsed.total === 0) {
      return {
        ...parsed,
        status: output.exitCode === 0 ? "pass" : "error",
        raw,
        exitCode: output.exitCode,
      };
    }
    return {
      ...parsed,
      status: parsed.fail > 0 ? "fail" : "pass",
      raw,
      exitCode: output.exitCode,
    };
  }
}
