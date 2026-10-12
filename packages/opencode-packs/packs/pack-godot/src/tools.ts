/** Stub tool definitions for the Godot editor bridge (scene open / headless run / ping). */

export interface GodotToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const GODOT_TOOLS: GodotToolDef[] = [
  {
    name: "godot.ping",
    description: "Handshake check: verify the Godot editor bridge is reachable.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "godot.openScene",
    description: "Open a scene file in the attached Godot editor.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative scene path, e.g. res://main.tscn" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "godot.runScene",
    description: "Run a scene headless and return captured output.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative scene path" },
        timeoutMs: { type: "number", description: "Kill timeout in milliseconds" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
];
