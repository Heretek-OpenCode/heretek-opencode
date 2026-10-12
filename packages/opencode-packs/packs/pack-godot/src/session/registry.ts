// Session readiness state machine (zero-Python).
// States mirror the editor bridge lifecycle; writes gate on writability.

export type SessionState =
  | "ready"
  | "importing"
  | "playing"
  | "no_scene"
  | "test_running";

export class EditorNotReadyError extends Error {
  readonly code = "EDITOR_NOT_READY";
  constructor(
    readonly sessionId: string,
    readonly state: SessionState,
  ) {
    super(`editor not ready for session ${sessionId}: ${state}`);
    this.name = "EditorNotReadyError";
  }
}

const WRITABLE: ReadonlySet<SessionState> = new Set(["ready", "playing"]);

export interface WaitOptions {
  readonly intervalMs?: number;
  readonly timeoutMs?: number;
}

export class SessionRegistry {
  private states = new Map<string, SessionState>();
  private activeId: string | null = null;

  register(sessionId: string, state: SessionState = "ready"): void {
    this.states.set(sessionId, state);
    this.activeId ??= sessionId;
  }

  remove(sessionId: string): void {
    this.states.delete(sessionId);
    if (this.activeId === sessionId) {
      this.activeId = this.states.keys().next().value ?? null;
    }
  }

  setState(sessionId: string, state: SessionState): void {
    if (!this.states.has(sessionId))
      throw new Error(`unknown session: ${sessionId}`);
    this.states.set(sessionId, state);
  }

  get(sessionId: string): SessionState | undefined {
    return this.states.get(sessionId);
  }

  setActive(sessionId: string): void {
    if (!this.states.has(sessionId))
      throw new Error(`unknown session: ${sessionId}`);
    this.activeId = sessionId;
  }

  active(): string | null {
    return this.activeId;
  }

  isWritable(sessionId: string): boolean {
    const state = this.states.get(sessionId);
    return state !== undefined && WRITABLE.has(state);
  }

  requireWritable(sessionId: string): SessionState {
    const state = this.states.get(sessionId);
    if (state === undefined) throw new Error(`unknown session: ${sessionId}`);
    if (!WRITABLE.has(state)) throw new EditorNotReadyError(sessionId, state);
    return state;
  }

  // Re-probe hold loop for reimports: poll until writable or budget expires.
  async waitForWritable(
    sessionId: string,
    options: WaitOptions = {},
  ): Promise<SessionState> {
    const intervalMs = options.intervalMs ?? 500;
    const timeoutMs = options.timeoutMs ?? 8000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        return this.requireWritable(sessionId);
      } catch (err) {
        if (!(err instanceof EditorNotReadyError)) throw err;
        if (Date.now() >= deadline) throw err;
        const remaining = deadline - Date.now();
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(intervalMs, remaining)),
        );
      }
    }
  }
}
