/** Minimal testkit: mock host server, mock MCP server, tmp git repo helpers. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export interface MockRoute {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

export interface MockHost {
  url: string;
  requests: { method: string; path: string; body: unknown }[];
  close: () => Promise<void>;
}

/** In-process mock HTTP server with canned routes (Bun.serve). */
export function startMockHost(routes: MockRoute[]): MockHost {
  const requests: MockHost["requests"] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const method: string = req.method.toUpperCase();
      let body: unknown = undefined;
      try {
        body = req.method === "GET" ? undefined : await req.json();
      } catch {
        body = undefined;
      }
      requests.push({ method, path: url.pathname, body });
      const route: MockRoute | undefined = routes.find(
        (r) => r.method.toUpperCase() === method && r.path === url.pathname,
      );
      if (!route) return new Response("not found", { status: 404 });
      if (route.status === 204) return new Response(null, { status: 204 });
      return Response.json(route.body, { status: route.status });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    close: async (): Promise<void> => {
      server.stop(true);
    },
  };
}

/** Minimal JSON-RPC 2.0 mock MCP server: responds to initialize + tools/list. */
export function startMockMcpServer(tools: { name: string; description: string }[]): MockHost {
  return startMockHost([
    {
      method: "POST",
      path: "/mcp",
      status: 200,
      body: { jsonrpc: "2.0", id: 1, result: { tools } },
    },
  ]);
}

/** Create a temp git repo with one committed file; returns its path. */
export function makeTmpGitRepo(seedFiles?: Record<string, string>): string {
  const dir: string = mkdtempSync(join(tmpdir(), "heretek-testkit-"));
  const files: Record<string, string> = seedFiles ?? { "hello.txt": "hello\n" };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed"], { cwd: dir });
  return dir;
}

/** Current HEAD sha of a repo dir. */
export function gitHead(dir: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
}
