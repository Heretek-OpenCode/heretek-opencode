@tool
extends EditorPlugin
## Godot OpenCode companion addon entry point (pack-godot stub).
##
## The full implementation (authenticated loopback bridge, dispatcher, domain
## handlers, debugger integration) ships as the versioned release artifact
## `godot_opencode-<version>.zip`. This stub exists so the addon identity
## (plugin.cfg) resolves in a project tree; it performs no bridge I/O itself.

const BRIDGE_HOST := "127.0.0.1"
const BRIDGE_PORT := 9500


func _enter_tree() -> void:
	print("[godot_opencode] stub loaded; install godot_opencode-<version>.zip for the full bridge")


func _exit_tree() -> void:
	pass
