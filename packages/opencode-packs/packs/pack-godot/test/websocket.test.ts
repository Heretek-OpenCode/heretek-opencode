import { describe, expect, test } from "bun:test";
import { GodotBridgeClient } from "../src/transport/websocket";

function startEchoServer(
  onMessage: (ws: { send: (s: string) => void }, raw: string) => void,
): { url: string; close: () => void } {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return undefined;
      return new Response("no", { status: 400 });
    },
    websocket: {
      open() {},
      message(ws, message) {
        onMessage(
          ws as unknown as { send: (s: string) => void },
          String(message),
        );
      },
      close() {},
    },
  });
  return { url: `ws://127.0.0.1:${server.port}`, close: () => server.stop() };
}

describe("GodotBridgeClient transport", () => {
  test("request/response correlation over loopback ws", async () => {
    const srv = startEchoServer((ws, raw) => {
      const req = JSON.parse(raw) as { id: number; method: string };
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { echo: req.method },
        }),
      );
    });
    try {
      const client = new GodotBridgeClient(srv.url);
      await client.connect();
      const result = (await client.sendRequest("editor_state", {}, 2000)) as {
        echo: string;
      };
      expect(result.echo).toBe("editor_state");
      await client.close();
    } finally {
      srv.close();
    }
  });

  test("interleaved notifications dispatch while request pending", async () => {
    const srv = startEchoServer((ws, raw) => {
      const req = JSON.parse(raw) as { id: number };
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "readiness",
          params: { state: "ready" },
        }),
      );
      setTimeout(
        () =>
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { ok: true },
            }),
          ),
        20,
      );
    });
    try {
      const client = new GodotBridgeClient(srv.url);
      const seen: unknown[] = [];
      client.onNotification((method, params) => seen.push([method, params]));
      await client.connect();
      const result = await client.sendRequest("ping", {}, 2000);
      expect(result).toEqual({ ok: true });
      expect(seen).toEqual([["readiness", { state: "ready" }]]);
      await client.close();
    } finally {
      srv.close();
    }
  });

  test("corrupted JSON-RPC frames surface as errors, connection survives", async () => {
    const srv = startEchoServer((ws, raw) => {
      const req = JSON.parse(raw) as { id: number };
      ws.send("this is not json{{{");
      setTimeout(
        () =>
          ws.send(
            JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { ok: 1 } }),
          ),
        20,
      );
    });
    try {
      const client = new GodotBridgeClient(srv.url);
      const errors: unknown[] = [];
      client.onFrameError((err) => errors.push(err));
      await client.connect();
      const result = await client.sendRequest("x", {}, 2000);
      expect(result).toEqual({ ok: 1 });
      expect(errors.length).toBeGreaterThan(0);
      await client.close();
    } finally {
      srv.close();
    }
  });

  test("oversized frames over 4MiB are rejected", async () => {
    const srv = startEchoServer((ws, raw) => {
      const req = JSON.parse(raw) as { id: number };
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { pad: "x".repeat(4 * 1024 * 1024 + 8) },
        }),
      );
    });
    try {
      const client = new GodotBridgeClient(srv.url, {
        maxFrameBytes: 4 * 1024 * 1024,
      });
      const errors: unknown[] = [];
      client.onFrameError((err) => errors.push(err));
      await client.connect();
      let failed = false;
      try {
        await client.sendRequest("big", {}, 2000);
      } catch {
        failed = true;
      }
      expect(failed || errors.length > 0).toBe(true);
      await client.close();
    } finally {
      srv.close();
    }
  });
});
