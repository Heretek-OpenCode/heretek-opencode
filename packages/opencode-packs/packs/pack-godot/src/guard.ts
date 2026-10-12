/** Minimal tool-guard stub: allow only godot.* tools through this pack's lane. */

const ALLOWED_PREFIX = "godot.";

export function guardTool(toolName: string): { allow: boolean; reason?: string } {
  if (toolName.startsWith(ALLOWED_PREFIX)) return { allow: true };
  return { allow: false, reason: `pack-godot guard blocks non-godot tool "${toolName}"` };
}
