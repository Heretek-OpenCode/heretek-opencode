import { afterEach, describe, expect, test } from "bun:test";
import { HostClient, HostClientError } from "../src/host/client.js";
import { startMockHost, type MockHost } from "../src/testkit/index.js";

let mock: MockHost | null = null;
afterEach(async () => {
  if (mock) {
    await mock.close();
    mock = null;
  }
});

describe("host client", () => {
  test("prompt posts text and returns inbox id", async () => {
    mock = startMockHost([
      { method: "POST", path: "/api/session/s1/prompt", status: 200, body: { data: { id: "inbox-1" } } },
    ]);
    const client = new HostClient({ baseUrl: mock.url });
    const res = await client.prompt("s1", "hello");
    expect(res.inboxId).toBe("inbox-1");
    expect(mock.requests[0]).toMatchObject({ method: "POST", path: "/api/session/s1/prompt" });
  });

  test("wait uses experimental endpoint when present", async () => {
    mock = startMockHost([
      { method: "POST", path: "/api/experimental/session/s1/wait", status: 204, body: null },
    ]);
    const client = new HostClient({ baseUrl: mock.url });
    await client.wait("s1", 5000);
    expect(mock.requests.map((r) => r.path)).toEqual(["/api/experimental/session/s1/wait"]);
  });

  test("wait falls back to polling message list when wait endpoint is missing", async () => {
    const messages = [{ id: "m1", role: "user" }];
    const fetchImpl: typeof fetch = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = new URL(typeof url === "string" ? url : url instanceof URL ? url.toString() : (url as Request).url);
      if (u.pathname === "/api/experimental/session/s1/wait") return new Response("nope", { status: 404 });
      if (u.pathname === "/api/session/s1/message") {
        return Response.json({ data: (init as unknown) ? messages : messages });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const client = new HostClient({ baseUrl: "http://x", fetchImpl, pollIntervalMs: 10 });
    await client.wait("s1", 2000);
  });

  test("diff returns file diffs", async () => {
    const diffs = [{ file: "a.ts", patch: "@@..", additions: 1, deletions: 0, status: "modified" }];
    mock = startMockHost([{ method: "GET", path: "/api/session/s1/diff", status: 200, body: { data: diffs } }]);
    const client = new HostClient({ baseUrl: mock.url });
    expect(await client.diff("s1")).toEqual(diffs);
  });

  test("interrupt + listMessages", async () => {
    mock = startMockHost([
      { method: "POST", path: "/api/session/s1/interrupt", status: 200, body: { data: true } },
      { method: "GET", path: "/api/session/s1/message", status: 200, body: { data: [{ id: "m1", role: "user" }] } },
    ]);
    const client = new HostClient({ baseUrl: mock.url });
    await client.interrupt("s1");
    expect(await client.listMessages("s1")).toHaveLength(1);
  });

  test("HTTP errors surface as HostClientError", async () => {
    mock = startMockHost([{ method: "GET", path: "/api/session/nope/diff", status: 404, body: { error: "gone" } }]);
    const client = new HostClient({ baseUrl: mock.url });
    await expect(client.diff("nope")).rejects.toBeInstanceOf(HostClientError);
  });
});
