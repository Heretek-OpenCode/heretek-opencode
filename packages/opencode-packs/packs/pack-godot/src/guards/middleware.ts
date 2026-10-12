// Safety middleware & write guards (zero-Python).
// Structural `tool.hook("execute.before")`-compatible interceptor defined
// locally: no @opencode/* imports. Blocks destructive shell commands and
// gates .gd/.tscn writes behind a pre-flight syntax check.

export interface ExecuteEvent {
  readonly command: string;
  readonly cwd?: string;
}

export interface WriteEvent {
  readonly path: string;
  readonly content: string;
}

export type HookDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly reason: string };

export interface GdCheckDiagnostic {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly message: string;
}

export interface GdCheckResult {
  readonly status: "ok" | "error" | "unavailable" | "timeout";
  readonly diagnostics: readonly GdCheckDiagnostic[];
  readonly raw: string;
}

export type GdCheckFn = (path: string) => Promise<GdCheckResult>;

export interface SafetyMiddlewareOptions {
  readonly checkGdscript?: GdCheckFn;
  readonly checkScene?: GdCheckFn;
  readonly extraBlockPatterns?: readonly RegExp[];
}

// rm -rf with a filesystem-root-ish target: /, /*, *, ~, ~/*, ., $HOME-ish.
const RM_RF_RE = /(^|[;&|]\s*|\bsudo\s+)rm\s+(?:-[a-zA-Z]*r[a-zA-Z]*\s+)+(\S+)/;
const RM_RF_TARGET_RE =
  /^(\/|\/\*|\*|~(~|\/.*)?|\.|\.\/.*|\$HOME.*|--no-preserve-root.*)$/;

const GIT_PUSH_FORCE_RE = /\bgit\b.*\bpush\b.*(--force\b|-f\b)/;
const GIT_RESET_HARD_RE = /\bgit\b.*\breset\b.*--hard\b/;

export function isDestructiveCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  const rmMatch = RM_RF_RE.exec(cmd);
  if (rmMatch) {
    const target = (rmMatch[2] ?? "").trim().replace(/['";]+$/, "");
    // Any rm -r[f] whose target is root-ish OR which has no safe-looking
    // relative-file target is treated as destructive. `rm file.txt` (no
    // recursive flag shape matched above only when -r present) is safe.
    if (RM_RF_TARGET_RE.test(target)) return true;
    // `rm -rf /tmp/x`, `rm -rf build/` — recursive deletes outside an
    // explicit allow-list are blocked by default pre-flight policy.
    if (target.length > 0) return true;
    return true;
  }
  // Bare `rm -rf` with no target is still destructive-shaped.
  if (/(^|[;&|]\s*|\bsudo\s+)rm\s+.*-[a-zA-Z]*rf[a-zA-Z]*\b/.test(cmd))
    return true;
  if (GIT_PUSH_FORCE_RE.test(cmd)) return true;
  if (GIT_RESET_HARD_RE.test(cmd)) return true;
  return false;
}

export function destructiveReason(command: string): string {
  if (GIT_PUSH_FORCE_RE.test(command))
    return "blocked destructive command: git push --force";
  if (GIT_RESET_HARD_RE.test(command))
    return "blocked destructive command: git reset --hard";
  if (/\brm\b/.test(command)) return "blocked destructive command: rm -rf";
  return "blocked destructive command";
}

function isScriptWrite(path: string): boolean {
  return /\.gd$/.test(path) || /\.tscn$/.test(path);
}

export class SafetyMiddleware {
  private readonly checkGdscript?: GdCheckFn;
  private readonly checkScene?: GdCheckFn;
  private readonly extraBlockPatterns: readonly RegExp[];

  constructor(options: SafetyMiddlewareOptions = {}) {
    this.checkGdscript = options.checkGdscript;
    this.checkScene = options.checkScene;
    this.extraBlockPatterns = options.extraBlockPatterns ?? [];
  }

  // Compatible with tool.hook("execute.before", (event) => ...): return a
  // decision; hosts treat allow:false as a veto.
  async beforeExecute(event: ExecuteEvent): Promise<HookDecision> {
    for (const re of this.extraBlockPatterns) {
      if (re.test(event.command)) {
        return {
          allow: false,
          reason: `blocked by custom policy: ${re.source}`,
        };
      }
    }
    if (isDestructiveCommand(event.command)) {
      return { allow: false, reason: destructiveReason(event.command) };
    }
    return { allow: true };
  }

  // Gate .gd/.tscn persists behind a pre-flight syntax check. Unavailable
  // checkers (no Godot binary) fail open with allow:true so offline edits
  // still work; hard syntax errors fail closed.
  async beforeWrite(event: WriteEvent): Promise<HookDecision> {
    if (!isScriptWrite(event.path)) return { allow: true };
    const checker = /\.tscn$/.test(event.path)
      ? (this.checkScene ?? this.checkGdscript)
      : this.checkGdscript;
    if (!checker) return { allow: true };
    let result: GdCheckResult;
    try {
      result = await checker(event.path);
    } catch (err) {
      return {
        allow: false,
        reason: `pre-flight check failed for ${event.path}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (result.status === "error") {
      const first = result.diagnostics[0];
      const detail = first
        ? `${first.file}:${first.line}:${first.col}: ${first.message}`
        : "syntax error";
      return {
        allow: false,
        reason: `pre-flight syntax check blocked write to ${event.path}: ${detail}`,
      };
    }
    return { allow: true };
  }
}
